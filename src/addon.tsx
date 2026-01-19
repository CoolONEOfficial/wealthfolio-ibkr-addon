import type { AddonContext, Account } from '@wealthfolio/addon-sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IBKRMultiImportPage from './pages/ibkr-multi-import-page';
import IBKRFlexSettingsPage from './pages/ibkr-flex-settings-page';
import { fetchFlexQuery, setHttpClient } from './lib/flex-query-fetcher';
import { parseFlexQueryCSV } from './lib/flex-csv-parser';
import {
  loadConfigs,
  saveConfigs,
  loadToken,
} from './lib/flex-config-storage';
import { detectCurrenciesFromIBKR } from './lib/currency-detector';
import { generateAccountNames } from './lib/account-name-generator';
import { preprocessIBKRData } from './lib/ibkr-preprocessor';
import { convertToActivityImports } from './lib/activity-converter';
import { deduplicateActivities } from './lib/activity-deduplicator';
import { AsyncLock } from './lib/async-lock';

// Cooldown: 6 hours (IBKR Activity Statements update once daily)
const FETCH_COOLDOWN_MS = 6 * 60 * 60 * 1000;

// Lock for preventing concurrent auto-fetch operations
const autoFetchLock = new AsyncLock();

// Create a shared QueryClient for addon pages that use React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reasonable defaults for addon context
      staleTime: 30 * 1000, // 30 seconds
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * IBKR Multi-Currency Import Addon
 *
 * This addon provides a comprehensive import solution for Interactive Brokers (IBKR)
 * activity statements. It supports:
 *
 * - Multiple CSV files in a single import session
 * - Automatic currency detection and multi-currency account creation
 * - ISIN-based ticker resolution
 * - FX conversion transaction splitting
 * - Reuse of existing accounts
 * - Flex Query API integration for automatic fetching and importing
 */
export function enable(ctx: AddonContext) {
  // Initialize HTTP client for Flex Query API requests
  if (ctx.api.http) {
    setHttpClient(ctx.api.http);
  }

  // Cleanup functions to call on disable
  const cleanupFunctions: (() => void)[] = [];

  // Wrap components to provide context
  // Settings page uses React Query hooks, so it needs QueryClientProvider
  const ImportPageWithContext = () => <IBKRMultiImportPage ctx={ctx} />;
  const SettingsPageWithContext = () => (
    <QueryClientProvider client={queryClient}>
      <IBKRFlexSettingsPage ctx={ctx} />
    </QueryClientProvider>
  );

  // Register the import page route
  ctx.router.add({
    path: 'activities/import/ibkr-multi',
    component: ImportPageWithContext as any,
  });

  // Register the settings page route
  ctx.router.add({
    path: 'settings/ibkr-flex',
    component: SettingsPageWithContext as any,
  });

  // Add sidebar item for import
  const importSidebarHandle = ctx.sidebar.addItem({
    id: 'ibkr-multi-import',
    label: 'IBKR Import',
    icon: 'Import',
    route: '/activities/import/ibkr-multi',
    order: 150,
  });
  cleanupFunctions.push(() => importSidebarHandle.remove());

  // Add sidebar item for settings
  const settingsSidebarHandle = ctx.sidebar.addItem({
    id: 'ibkr-flex-settings',
    label: 'IBKR Settings',
    icon: 'Settings',
    route: '/settings/ibkr-flex',
    order: 151,
  });
  cleanupFunctions.push(() => settingsSidebarHandle.remove());

  /**
   * Get or create accounts for each currency in an account group
   */
  async function getOrCreateAccountsForGroup(
    accountGroup: string,
    currencies: string[]
  ): Promise<Map<string, Account>> {
    const accountsByCurrency = new Map<string, Account>();

    // Get existing accounts
    const allAccounts = await ctx.api.accounts?.getAll() || [];
    const groupAccounts = allAccounts.filter((a) => a.group === accountGroup);

    // Generate expected account names
    const expectedNames = generateAccountNames(accountGroup, currencies);

    for (const expected of expectedNames) {
      // Check if account exists
      const existing = groupAccounts.find(
        (a) => a.name === expected.name && a.currency === expected.currency
      );

      if (existing) {
        accountsByCurrency.set(expected.currency, existing);
      } else {
        // Create new account
        try {
          const newAccount = await ctx.api.accounts?.create({
            name: expected.name,
            currency: expected.currency,
            group: accountGroup,
            accountType: 'SECURITIES',
            isDefault: false,
            isActive: true,
          });
          if (newAccount) {
            accountsByCurrency.set(expected.currency, newAccount);
            ctx.api.logger?.info(`Created account: ${expected.name}`);
          }
        } catch (e) {
          ctx.api.logger?.error(`Failed to create account ${expected.name}: ${e}`);
        }
      }
    }

    return accountsByCurrency;
  }

  /**
   * Auto-fetch and import for all enabled configs
   */
  const performAutoFetch = async () => {
    // Use lock to prevent concurrent fetches (tryAcquire for non-blocking check)
    const release = autoFetchLock.tryAcquire();
    if (!release) {
      ctx.api.logger?.trace("IBKR auto-fetch skipped: fetch already in progress");
      return;
    }

    try {
      // Load shared token
      const token = await loadToken(ctx.api.secrets);
      if (!token) {
        ctx.api.logger?.trace("IBKR auto-fetch skipped: no token configured");
        return;
      }

      // Load all configs
      const configs = await loadConfigs(ctx.api.secrets);
      const enabledConfigs = configs.filter((c) => c.autoFetchEnabled);

      if (enabledConfigs.length === 0) {
        ctx.api.logger?.trace("IBKR auto-fetch skipped: no auto-fetch configs enabled");
        return;
      }

      ctx.api.logger?.info(`IBKR auto-fetch: Processing ${enabledConfigs.length} configs...`);

      // Process each enabled config
      for (const config of enabledConfigs) {
        try {
          // Check per-config cooldown
          if (config.lastFetchTime) {
            const lastFetchMs = new Date(config.lastFetchTime).getTime();
            // Skip cooldown check if date is invalid (NaN)
            if (!isNaN(lastFetchMs)) {
              const timeSince = Date.now() - lastFetchMs;
              if (timeSince < FETCH_COOLDOWN_MS) {
                const hoursRemaining = Math.round((FETCH_COOLDOWN_MS - timeSince) / (60 * 60 * 1000) * 10) / 10;
                ctx.api.logger?.trace(`IBKR auto-fetch [${config.name}]: cooldown active (${hoursRemaining}h remaining)`);
                continue;
              }
            }
          }

          ctx.api.logger?.info(`IBKR auto-fetch [${config.name}]: Starting...`);

          // 1. Fetch CSV from IBKR
          const result = await fetchFlexQuery(
            { token, queryId: config.queryId },
            { onProgress: (msg) => ctx.api.logger?.trace(`IBKR auto-fetch [${config.name}]: ${msg}`) }
          );

          if (!result.success || !result.csv) {
            throw new Error(result.error || "Fetch failed");
          }

          // 2. Parse CSV
          const parsed = parseFlexQueryCSV(result.csv);
          if (parsed.errors.length > 0) {
            ctx.api.logger?.warn(`IBKR auto-fetch [${config.name}]: Parse warnings: ${parsed.errors.join(", ")}`);
          }

          if (parsed.rows.length === 0) {
            ctx.api.logger?.info(`IBKR auto-fetch [${config.name}]: No transactions found`);
            // Update status even for empty results
            config.lastFetchTime = new Date().toISOString();
            config.lastFetchStatus = 'success';
            config.lastFetchError = undefined;
            try {
              await saveConfigs(ctx.api.secrets, configs);
            } catch (saveError) {
              ctx.api.logger?.warn(`IBKR auto-fetch [${config.name}]: Failed to save status`);
            }
            continue;
          }

          // 3. Detect currencies and get/create accounts
          const currencies = detectCurrenciesFromIBKR(parsed.rows);
          const accountsByCurrency = await getOrCreateAccountsForGroup(config.accountGroup, currencies);

          // 4. Preprocess the data
          const preprocessResult = preprocessIBKRData(parsed.rows);
          const processedData = preprocessResult.processedData;

          // 5. Build account previews for the converter
          const accountPreviews = currencies.map((currency) => ({
            currency,
            name: `${config.accountGroup} - ${currency}`,
            existingAccount: accountsByCurrency.get(currency),
          }));

          // 6. Convert to activity imports
          const allActivities = await convertToActivityImports(processedData, accountPreviews);

          // 7. Set accountId on each activity and import with deduplication
          let totalImported = 0;
          let totalSkipped = 0;
          for (const currency of currencies) {
            const account = accountsByCurrency.get(currency);
            if (!account) continue;

            // Filter activities for this currency account
            const currencyActivities = allActivities.filter((a) => a.currency === currency);
            if (currencyActivities.length === 0) continue;

            // Set accountId on each activity
            const activitiesWithAccountId = currencyActivities.map((a) => ({
              ...a,
              accountId: account.id,
            }));

            // Deduplicate and import
            if (activitiesWithAccountId.length > 0 && ctx.api.activities) {
              try {
                // Deduplicate before importing
                const { toImport, duplicatesSkipped } = await deduplicateActivities(
                  activitiesWithAccountId,
                  account.id,
                  async (accountId: string) => {
                    const activities = await ctx.api.activities!.getAll(accountId);
                    return activities.map((a: any) => ({
                      activityDate: a.date,
                      assetId: a.assetSymbol, // Use assetSymbol (ticker) not assetId (internal ID)
                      activityType: a.activityType,
                      quantity: a.quantity,
                      unitPrice: a.unitPrice,
                      amount: a.amount,
                      fee: a.fee,
                      currency: a.currency,
                      comment: a.comment, // Include comment for dividend per-share fingerprinting
                    }));
                  }
                );

                totalSkipped += duplicatesSkipped;

                if (toImport.length > 0) {
                  await ctx.api.activities.import(toImport);
                  totalImported += toImport.length;
                  ctx.api.logger?.trace(`IBKR auto-fetch [${config.name}]: Imported ${toImport.length} to ${account.name}`);
                }

                if (duplicatesSkipped > 0) {
                  ctx.api.logger?.trace(`IBKR auto-fetch [${config.name}]: Skipped ${duplicatesSkipped} duplicates for ${account.name}`);
                }
              } catch (importError) {
                ctx.api.logger?.warn(`IBKR auto-fetch [${config.name}]: Import error for ${account.name}: ${importError}`);
              }
            }
          }

          // 6. Update config status
          config.lastFetchTime = new Date().toISOString();
          config.lastFetchStatus = 'success';
          config.lastFetchError = undefined;
          try {
            await saveConfigs(ctx.api.secrets, configs);
          } catch (saveError) {
            ctx.api.logger?.warn(`IBKR auto-fetch [${config.name}]: Failed to save success status`);
          }

          const skippedMsg = totalSkipped > 0 ? `, ${totalSkipped} duplicates skipped` : "";
          ctx.api.logger?.info(`IBKR auto-fetch [${config.name}]: Complete - ${totalImported} transactions imported${skippedMsg}`);

        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          ctx.api.logger?.error(`IBKR auto-fetch [${config.name}]: Error - ${msg}`);

          // Update config with error status
          config.lastFetchTime = new Date().toISOString();
          config.lastFetchStatus = 'error';
          config.lastFetchError = msg;
          try {
            await saveConfigs(ctx.api.secrets, configs);
          } catch (saveError) {
            ctx.api.logger?.warn(`IBKR auto-fetch [${config.name}]: Failed to save error status`);
          }
        }
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      ctx.api.logger?.error(`IBKR auto-fetch error: ${msg}`);
    } finally {
      release();
    }
  };

  // Register event listener for portfolio updates (if events API is available)
  if (ctx.api.events?.portfolio?.onUpdateComplete) {
    ctx.api.events.portfolio.onUpdateComplete(performAutoFetch).then((unlisten) => {
      cleanupFunctions.push(unlisten);
      ctx.api.logger?.trace("IBKR addon: Registered portfolio update listener");
    }).catch((error) => {
      ctx.api.logger?.warn(`IBKR addon: Failed to register event listener: ${error}`);
    });
  }

  // Return cleanup function
  return {
    disable: () => {
      for (const cleanup of cleanupFunctions) {
        try {
          cleanup();
        } catch (e) {
          ctx.api.logger?.warn?.(`IBKR addon cleanup error: ${String(e)}`);
        }
      }
      ctx.api.logger?.info("IBKR addon disabled");
    },
  };
}

// Default export for different bundling scenarios
export default enable;

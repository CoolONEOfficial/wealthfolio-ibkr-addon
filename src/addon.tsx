import React from 'react';
import type { AddonContext, Account } from '@wealthfolio/addon-sdk';

// Use the host app's toast function (exposed on window) to ensure toasts appear in the main Toaster
const getToast = () => (window as unknown as { __wealthfolio_toast__?: typeof import('sonner').toast }).__wealthfolio_toast__;
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IBKRMultiImportPage from './pages/ibkr-multi-import-page';
import IBKRFlexSettingsPage from './pages/ibkr-flex-settings-page';
import { fetchFlexQuery, setHttpClient } from './lib/flex-query-fetcher';
import { parseFlexQueryCSV } from './lib/flex-csv-parser';
import {
  loadConfigs,
  loadToken,
  updateConfigStatus,
} from './lib/flex-config-storage';
import { detectCurrenciesFromIBKR } from './lib/currency-detector';
import { generateAccountNames } from './lib/account-name-generator';
import { preprocessIBKRData } from './lib/ibkr-preprocessor';
import { convertToActivityImports } from './lib/activity-converter';
import { deduplicateActivities } from './lib/activity-deduplicator';
import { AsyncLock } from './lib/async-lock';
import { QUERY_STALE_TIME_MS, AUTO_FETCH_DEBOUNCE_MS } from './lib/constants';
import {
  isConfigInCooldown,
  createActivityFingerprintGetter,
  createSuccessStatus,
  createErrorStatus,
  formatImportResultMessage,
} from './lib/auto-fetch-helpers';

// Lock for preventing concurrent auto-fetch operations
const autoFetchLock = new AsyncLock();

/**
 * Create a debounced version of a function with cleanup support
 * Multiple calls within the delay period consolidate into one call after the delay
 * Returns both the debounced function and a cleanup function to cancel pending timeouts
 */
function createDebouncedFunction<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number
): { debounced: (...args: Parameters<T>) => void; cleanup: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn(...args);
    }, delayMs);
  };

  const cleanup = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return { debounced, cleanup };
}

// Create a shared QueryClient for addon pages that use React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reasonable defaults for addon context
      staleTime: QUERY_STALE_TIME_MS,
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

  // Create lazy-loaded components that match SDK's expected type
  // React.lazy() returns LazyExoticComponent which is what the router expects
  const LazyImportPage = React.lazy(() =>
    Promise.resolve({
      default: () => <IBKRMultiImportPage ctx={ctx} />,
    })
  );

  const LazySettingsPage = React.lazy(() =>
    Promise.resolve({
      default: () => (
        <QueryClientProvider client={queryClient}>
          <IBKRFlexSettingsPage ctx={ctx} />
        </QueryClientProvider>
      ),
    })
  );

  // Register the import page route
  ctx.router.add({
    path: 'activities/import/ibkr-multi',
    component: LazyImportPage,
  });

  // Register the settings page route
  ctx.router.add({
    path: 'settings/ibkr-flex',
    component: LazySettingsPage,
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
        // Create a toast ID for this config to update it later
        const toastId = `ibkr-fetch-${config.id}`;

        try {
          // Check per-config cooldown
          const cooldownCheck = isConfigInCooldown(config.lastFetchTime);
          if (cooldownCheck.inCooldown) {
            ctx.api.logger?.trace(`IBKR auto-fetch [${config.name}]: cooldown active (${cooldownCheck.hoursRemaining}h remaining)`);
            continue;
          }

          ctx.api.logger?.info(`IBKR auto-fetch [${config.name}]: Starting...`);

          // Show loading toast
          const toast = getToast();
          toast?.loading(`IBKR: Fetching ${config.name}...`, { id: toastId });

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
            // Update status even for empty results (atomically to avoid race conditions)
            try {
              await updateConfigStatus(ctx.api.secrets, config.id, createSuccessStatus());
            } catch (saveError) {
              ctx.api.logger?.warn(`IBKR auto-fetch [${config.name}]: Failed to save status`);
            }
            // Show info toast for no new transactions
            getToast()?.success(`IBKR: ${config.name}`, {
              id: toastId,
              description: "No new transactions found",
            });
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
                const getExistingFingerprints = createActivityFingerprintGetter(ctx.api.activities);
                const { toImport, duplicatesSkipped } = await deduplicateActivities(
                  activitiesWithAccountId,
                  account.id,
                  getExistingFingerprints
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

          // 6. Update config status (atomically to avoid race conditions)
          try {
            await updateConfigStatus(ctx.api.secrets, config.id, createSuccessStatus());
          } catch (saveError) {
            ctx.api.logger?.warn(`IBKR auto-fetch [${config.name}]: Failed to save success status`);
          }

          const resultMessage = formatImportResultMessage(totalImported, totalSkipped);
          ctx.api.logger?.info(`IBKR auto-fetch [${config.name}]: Complete - ${resultMessage}`);

          // Show success toast
          getToast()?.success(`IBKR: ${config.name}`, {
            id: toastId,
            description: resultMessage,
          });

        } catch (error) {
          const errorStatus = createErrorStatus(error);
          ctx.api.logger?.error(`IBKR auto-fetch [${config.name}]: Error - ${errorStatus.lastFetchError}`);

          // Show error toast
          getToast()?.error(`IBKR: ${config.name} failed`, {
            id: toastId,
            description: errorStatus.lastFetchError,
          });

          // Update config with error status (atomically to avoid race conditions)
          try {
            await updateConfigStatus(ctx.api.secrets, config.id, errorStatus);
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
  // Use debounce to consolidate rapid portfolio update events into one fetch attempt
  // This prevents race conditions where multiple events fire before the first completes
  if (ctx.api.events?.portfolio?.onUpdateComplete) {
    const { debounced: debouncedAutoFetch, cleanup: cleanupDebounce } = createDebouncedFunction(
      performAutoFetch,
      AUTO_FETCH_DEBOUNCE_MS
    );

    // Add debounce cleanup to run on disable
    cleanupFunctions.push(cleanupDebounce);

    // Register event listener - use void to explicitly mark fire-and-forget
    // and handle errors synchronously to prevent unhandled rejections
    void ctx.api.events.portfolio.onUpdateComplete(debouncedAutoFetch)
      .then((unlisten) => {
        cleanupFunctions.push(unlisten);
        ctx.api.logger?.trace(`IBKR addon: Registered portfolio update listener (${AUTO_FETCH_DEBOUNCE_MS}ms debounce)`);
      })
      .catch((error) => {
        // Log but don't rethrow - addon should continue working even if event registration fails
        ctx.api.logger?.warn(`IBKR addon: Failed to register event listener: ${error instanceof Error ? error.message : String(error)}`);
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

import React from 'react';
import type { AddonContext, Account } from '@wealthfolio/addon-sdk';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IBKRMultiImportPage from './pages/ibkr-multi-import-page';
import IBKRFlexSettingsPage from './pages/ibkr-flex-settings-page';
import { setHttpClient } from './lib/flex-query-fetcher';
import {
  loadConfigsSafe,
  loadToken,
  updateConfigStatus,
} from './lib/flex-config-storage';
import { generateAccountNames } from './lib/account-name-generator';
import { AsyncLock } from './lib/async-lock';
import { QUERY_STALE_TIME_MS, AUTO_FETCH_DEBOUNCE_MS } from './lib/constants';
import {
  isConfigInCooldown,
  createPendingStatus,
} from './lib/auto-fetch-helpers';
import { processFlexQueryConfig } from './lib/auto-fetch-processor';
import { getErrorMessage } from './lib/shared-utils';

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
  // Track if addon has been disabled to prevent adding cleanup functions after disable
  let isDisabled = false;

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
          } else {
            // API returned null/undefined without throwing - treat as error
            ctx.api.logger?.error(`Failed to create account ${expected.name}: API returned null`);
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
   * Orchestrates the fetch process while delegating actual processing to auto-fetch-processor
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

      // Load all configs (using safe loader to distinguish errors from empty)
      const loadResult = await loadConfigsSafe(ctx.api.secrets);
      if (!loadResult.success) {
        ctx.api.logger?.error(`IBKR auto-fetch: Failed to load configs - ${loadResult.error}`);
        return;
      }
      const configs = loadResult.configs ?? [];
      const enabledConfigs = configs.filter((c) => c.autoFetchEnabled);

      if (enabledConfigs.length === 0) {
        ctx.api.logger?.trace("IBKR auto-fetch skipped: no auto-fetch configs enabled");
        return;
      }

      ctx.api.logger?.info(`IBKR auto-fetch: Processing ${enabledConfigs.length} configs...`);

      // Process each enabled config
      for (const config of enabledConfigs) {
        // Check per-config cooldown (initial check using cached config)
        const cooldownCheck = isConfigInCooldown(config.lastFetchTime);
        if (cooldownCheck.inCooldown) {
          ctx.api.logger?.trace(`IBKR auto-fetch [${config.name}]: cooldown active (${cooldownCheck.hoursRemaining}h remaining)`);
          continue;
        }

        // TOCTOU fix: Re-load and re-check config right before fetch
        const freshLoadResult = await loadConfigsSafe(ctx.api.secrets);
        if (freshLoadResult.success) {
          const freshConfig = freshLoadResult.configs?.find(c => c.id === config.id);
          if (freshConfig) {
            const freshCooldownCheck = isConfigInCooldown(freshConfig.lastFetchTime);
            if (freshCooldownCheck.inCooldown) {
              ctx.api.logger?.trace(`IBKR auto-fetch [${config.name}]: cooldown became active (${freshCooldownCheck.hoursRemaining}h remaining)`);
              continue;
            }
          }
        }

        ctx.api.logger?.info(`IBKR auto-fetch [${config.name}]: Starting...`);

        // TOCTOU fix: Claim the config by updating lastFetchTime BEFORE starting fetch
        try {
          await updateConfigStatus(ctx.api.secrets, config.id, createPendingStatus());
        } catch (claimError) {
          ctx.api.logger?.warn(`IBKR auto-fetch [${config.name}]: Failed to claim config, skipping`);
          continue;
        }

        // Process the config using the extracted processor
        await processFlexQueryConfig(config, {
          ctx,
          token,
          getOrCreateAccountsForGroup,
        });
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
        // If addon was disabled while registration was pending, clean up immediately
        if (isDisabled) {
          try {
            unlisten();
          } catch (error) {
            ctx.api.logger?.warn(`IBKR addon: Failed to unregister event listener (late cleanup): ${getErrorMessage(error)}`);
          }
          return;
        }

        // Wrap unlisten in error handler at registration time for better cleanup safety
        cleanupFunctions.push(() => {
          try {
            unlisten();
          } catch (error) {
            ctx.api.logger?.warn(`IBKR addon: Failed to unregister event listener: ${getErrorMessage(error)}`);
          }
        });
        ctx.api.logger?.trace(`IBKR addon: Registered portfolio update listener (${AUTO_FETCH_DEBOUNCE_MS}ms debounce)`);
      })
      .catch((error) => {
        // Log but don't rethrow - addon should continue working even if event registration fails
        ctx.api.logger?.warn(`IBKR addon: Failed to register event listener: ${getErrorMessage(error)}`);
      });
  }

  // Return cleanup function
  return {
    disable: () => {
      // Mark as disabled first to prevent race conditions with async registrations
      isDisabled = true;

      for (const cleanup of cleanupFunctions) {
        try {
          cleanup();
        } catch (e) {
          ctx.api.logger?.warn(`IBKR addon cleanup error: ${String(e)}`);
        }
      }
      ctx.api.logger?.info("IBKR addon disabled");
    },
  };
}

// Default export for different bundling scenarios
export default enable;

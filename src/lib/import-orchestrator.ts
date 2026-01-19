/**
 * Import Orchestrator - Helper functions for the import process
 *
 * Extracted from handleProceedToStep3 to break up the god function
 * into smaller, more testable units.
 */

import { debug } from "./debug-logger";
import { getErrorMessage, formatDateToISO } from "./shared-utils";
import type { Account, HostAPI, ActivityImport, QuoteSummary } from "@wealthfolio/addon-sdk";
import type { AccountPreview, TransactionGroup, ActivityFingerprint, ConversionError } from "../types";
import { preprocessIBKRData } from "./ibkr-preprocessor";
import { resolveTickersFromIBKR } from "./ticker-resolution-service";
import { convertToActivityImports } from "./activity-converter";
import { splitFXConversions, SkippedFXConversion } from "./fx-transaction-splitter";
import { filterDuplicateActivities } from "./activity-deduplicator";
import type { CsvRowData } from "../presets/types";

type AccountsAPI = HostAPI["accounts"];
type ActivitiesAPI = HostAPI["activities"];
type MarketSearchFn = ((query: string) => Promise<QuoteSummary[]>) | undefined;
type ProgressCallback = (current: number, total: number) => void;

/**
 * Result of processing and resolving data
 */
export interface ProcessAndResolveResult {
  activities: ActivityImport[];
  conversionErrors: ConversionError[];
  skippedCount: number;
  /** FX conversions that were skipped (missing accounts, etc.) */
  skippedFXConversions: SkippedFXConversion[];
}

/**
 * Result of fetching existing activities for deduplication
 */
export interface FetchExistingResult {
  /** Successfully fetched activities */
  activities: ActivityFingerprint[];
  /** Accounts that failed to load (partial failure) */
  failedAccounts: string[];
  /** Whether all accounts loaded successfully */
  complete: boolean;
}

/**
 * Refresh accounts and update previews with fresh account data
 */
export async function refreshAndUpdateAccountPreviews(
  accountsApi: AccountsAPI | undefined,
  currentPreviews: AccountPreview[],
  currentAccounts: Account[]
): Promise<{ freshAccounts: Account[]; updatedPreviews: AccountPreview[] }> {
  let freshAccounts = currentAccounts;

  if (accountsApi) {
    try {
      freshAccounts = await accountsApi.getAll();
    } catch (e) {
      debug.warn(`Failed to refresh accounts, using cached list: ${getErrorMessage(e)}`);
    }
  }

  // Update previews with fresh account data for deduplication
  const updatedPreviews = currentPreviews.map((preview) => {
    const existingAccount = freshAccounts.find(
      (a) => a.name === preview.name && a.currency === preview.currency
    );
    return { ...preview, existingAccount };
  });

  return { freshAccounts, updatedPreviews };
}

/**
 * Process raw IBKR data, resolve tickers, and convert to activities
 */
export async function processAndResolveData(
  parsedData: CsvRowData[],
  accountPreviews: AccountPreview[],
  searchFn: MarketSearchFn,
  onProgress?: ProgressCallback
): Promise<ProcessAndResolveResult> {
  // Preprocess the raw data
  const { processedData } = preprocessIBKRData(parsedData);

  // Resolve tickers using market search
  // Adapt MarketSearchFn to SearchTickerFn by wrapping results with index signature
  const adaptedSearchFn = searchFn
    ? async (query: string) => {
        const results = await searchFn(query);
        // Map QuoteSummary[] to TickerSearchResult[] by spreading to add index signature compatibility
        return results.map((r) => ({ ...r } as { symbol: string; name?: string; exchange?: string; score?: number; [key: string]: unknown }));
      }
    : undefined;
  const resolvedData = await resolveTickersFromIBKR(processedData, onProgress, adaptedSearchFn);

  // Convert to activity imports (now returns errors too)
  const conversionResult = await convertToActivityImports(resolvedData, accountPreviews);

  // Create accounts-by-currency map for FX splitting
  const accountsByCurrency = new Map<string, Account>(
    accountPreviews
      .filter((p) => p.existingAccount)
      .map((p) => [p.currency as string, p.existingAccount as Account])
  );

  // Split FX conversions
  const fxSplitResult = splitFXConversions(conversionResult.activities, accountsByCurrency);

  // Log skipped FX conversions as warnings
  if (fxSplitResult.skippedConversions.length > 0) {
    debug.warn(
      `Skipped ${fxSplitResult.skippedConversions.length} FX conversion(s):`,
      fxSplitResult.skippedConversions.map((s) => `${s.symbol}: ${s.reason}`)
    );
  }

  return {
    activities: fxSplitResult.transactions,
    conversionErrors: conversionResult.errors,
    skippedCount: conversionResult.skipped,
    skippedFXConversions: fxSplitResult.skippedConversions,
  };
}

/**
 * Fetch existing activities from all existing accounts for deduplication
 */
export async function fetchExistingActivitiesForDedup(
  activitiesApi: ActivitiesAPI | undefined,
  accountPreviews: AccountPreview[]
): Promise<FetchExistingResult> {
  const allExisting: ActivityFingerprint[] = [];
  const failedAccounts: string[] = [];

  if (!activitiesApi) {
    return { activities: allExisting, failedAccounts: [], complete: true };
  }

  const existingAccounts = accountPreviews.filter((p) => p.existingAccount);

  for (const preview of existingAccounts) {
    // Extra runtime guard - existingAccount should always exist due to filter above
    const account = preview.existingAccount;
    if (!account) {
      debug.warn(`Skipping preview without account: ${preview.currency}`);
      continue;
    }

    try {
      const accountActivities = await activitiesApi.getAll(account.id);
      // Defensive check: ensure API returned an array
      if (!Array.isArray(accountActivities)) {
        debug.warn(`API returned non-array for account ${account.id}, skipping`);
        continue;
      }
      const mapped: ActivityFingerprint[] = accountActivities.map((a) => ({
        activityDate: formatDateToISO(a.date),
        assetId: a.assetSymbol,
        activityType: a.activityType,
        quantity: a.quantity,
        unitPrice: a.unitPrice,
        amount: a.amount,
        fee: a.fee,
        currency: a.currency,
        comment: a.comment,
      }));
      allExisting.push(...mapped);
    } catch (e) {
      const accountName = account.name || preview.currency;
      failedAccounts.push(accountName);
      debug.warn(`Failed to fetch existing activities for ${accountName}: ${getErrorMessage(e)}`);
    }
  }

  return {
    activities: allExisting,
    failedAccounts,
    complete: failedAccounts.length === 0,
  };
}

/**
 * Deduplicate activities and log the results
 */
export function deduplicateActivities(
  activities: ActivityImport[],
  existingActivities: ActivityFingerprint[]
): ActivityImport[] {
  const { unique, duplicates } = filterDuplicateActivities(activities, existingActivities);

  if (duplicates.length > 0) {
    debug.log(`[Dedup] Removed ${duplicates.length} duplicate activities`);
    debug.log(
      `[Dedup] By type:`,
      duplicates.reduce<Record<string, number>>(
        (acc, d) => {
          const key = `${d.currency}-${d.activityType}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        },
        {}
      )
    );
  }

  return unique;
}

/**
 * Group deduplicated activities by currency
 */
export function groupActivitiesByCurrency(
  activities: ActivityImport[]
): Map<string, ActivityImport[]> {
  const grouped = new Map<string, ActivityImport[]>();

  for (const activity of activities) {
    // Skip activities without currency - don't silently default
    if (!activity.currency) {
      debug.warn(
        `Skipping activity without currency: ${activity.symbol || "unknown"} on ${activity.date || "unknown date"}`
      );
      continue;
    }
    const currency = activity.currency;
    const existing = grouped.get(currency);
    if (existing) {
      existing.push(activity);
    } else {
      grouped.set(currency, [activity]);
    }
  }

  return grouped;
}

/**
 * Create transaction groups from grouped activities
 */
export function createTransactionGroups(
  accountPreviews: AccountPreview[],
  groupedByCurrency: Map<string, ActivityImport[]>
): TransactionGroup[] {
  return accountPreviews.map((preview) => {
    const transactions = groupedByCurrency.get(preview.currency) || [];
    return {
      currency: preview.currency,
      accountName: preview.name,
      transactions,
      summary: {
        trades: transactions.filter(
          (t) => t.activityType === "BUY" || t.activityType === "SELL"
        ).length,
        dividends: transactions.filter((t) => t.activityType === "DIVIDEND").length,
        deposits: transactions.filter(
          (t) => t.activityType === "DEPOSIT" || t.activityType === "TRANSFER_IN"
        ).length,
        withdrawals: transactions.filter(
          (t) => t.activityType === "WITHDRAWAL" || t.activityType === "TRANSFER_OUT"
        ).length,
        fees: transactions.filter((t) => t.activityType === "FEE" || t.activityType === "TAX").length,
        other: transactions.filter(
          (t) => !t.activityType || (t.activityType as string) === "UNKNOWN"
        ).length,
      },
    };
  });
}

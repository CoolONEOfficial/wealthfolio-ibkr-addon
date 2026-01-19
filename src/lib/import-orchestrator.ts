/**
 * Import Orchestrator - Helper functions for the import process
 *
 * Extracted from handleProceedToStep3 to break up the god function
 * into smaller, more testable units.
 */

import type { Account, HostAPI, ActivityImport, QuoteSummary } from "@wealthfolio/addon-sdk";
import type { AccountPreview, TransactionGroup, ActivityFingerprint } from "../types";
import { preprocessIBKRData } from "./ibkr-preprocessor";
import { resolveTickersFromIBKR } from "./ticker-resolution-service";
import { convertToActivityImports } from "./activity-converter";
import { splitFXConversions } from "./fx-transaction-splitter";
import { filterDuplicateActivities } from "./activity-deduplicator";
import type { CsvRowData } from "../presets/types";

type AccountsAPI = HostAPI["accounts"];
type ActivitiesAPI = HostAPI["activities"];
type MarketSearchFn = ((query: string) => Promise<QuoteSummary[]>) | undefined;
type ProgressCallback = (current: number, total: number) => void;

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
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.warn(`Failed to refresh accounts, using cached list: ${errorMsg}`);
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
): Promise<ActivityImport[]> {
  // Preprocess the raw data
  const { processedData } = preprocessIBKRData(parsedData);

  // Resolve tickers using market search
  const resolvedData = await resolveTickersFromIBKR(processedData, onProgress, searchFn);

  // Convert to activity imports
  const activities = await convertToActivityImports(resolvedData, accountPreviews);

  // Create accounts-by-currency map for FX splitting
  const accountsByCurrency = new Map<string, Account>(
    accountPreviews
      .filter((p) => p.existingAccount)
      .map((p) => [p.currency as string, p.existingAccount as Account])
  );

  // Split FX conversions
  return splitFXConversions(activities, accountsByCurrency);
}

/**
 * Fetch existing activities from all existing accounts for deduplication
 */
export async function fetchExistingActivitiesForDedup(
  activitiesApi: ActivitiesAPI | undefined,
  accountPreviews: AccountPreview[]
): Promise<ActivityFingerprint[]> {
  const allExisting: ActivityFingerprint[] = [];

  if (!activitiesApi) {
    return allExisting;
  }

  const existingAccounts = accountPreviews.filter((p) => p.existingAccount);

  for (const preview of existingAccounts) {
    try {
      const accountActivities = await activitiesApi.getAll(preview.existingAccount!.id);
      const mapped: ActivityFingerprint[] = accountActivities.map((a) => ({
        activityDate:
          a.date instanceof Date ? a.date.toISOString().split("T")[0] : String(a.date),
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
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.warn(`Failed to fetch existing activities for ${preview.currency}: ${errorMsg}`);
    }
  }

  return allExisting;
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
    console.log(`[Dedup] Removed ${duplicates.length} duplicate activities`);
    console.log(
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
    const currency = activity.currency || "USD";
    if (!grouped.has(currency)) {
      grouped.set(currency, []);
    }
    grouped.get(currency)!.push(activity);
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
          (t) => t.activityType?.includes("BUY") || t.activityType?.includes("SELL")
        ).length,
        dividends: transactions.filter((t) => t.activityType?.includes("DIVIDEND")).length,
        deposits: transactions.filter(
          (t) => t.activityType === "DEPOSIT" || t.activityType === "TRANSFER_IN"
        ).length,
        withdrawals: transactions.filter(
          (t) => t.activityType === "WITHDRAWAL" || t.activityType === "TRANSFER_OUT"
        ).length,
        fees: transactions.filter((t) => t.activityType?.includes("FEE")).length,
        other: transactions.filter(
          (t) => !t.activityType || (t.activityType as string) === "UNKNOWN"
        ).length,
      },
    };
  });
}

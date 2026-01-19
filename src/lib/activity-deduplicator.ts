/**
 * Activity Deduplication Service
 *
 * Creates fingerprints for activities and filters out duplicates
 * before importing to avoid duplicate transactions.
 */

import type { ActivityImport } from "@wealthfolio/addon-sdk";
import { MAX_DEBUG_LOGS } from "./constants";
import { extractDividendPerShare } from "./dividend-utils";
import { formatDateToISO } from "./shared-utils";
import { debug } from "./debug-logger";

/**
 * Normalize a numeric value for fingerprinting
 * Handles floating point precision issues by rounding to 6 decimal places
 */
function normalizeNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) {
    return "0.000000";
  }
  // Round to 6 decimal places to handle floating point precision issues
  return Number(value).toFixed(6);
}

/**
 * Normalize a date for fingerprinting
 * Extracts just the date part (YYYY-MM-DD) to handle timezone differences
 * Handles both Date objects and string formats
 */
function normalizeDate(dateValue: Date | string | undefined | null): string {
  if (!dateValue) return "";

  // If it's a Date object, convert to ISO string first
  let dateStr: string;
  if (dateValue instanceof Date) {
    dateStr = dateValue.toISOString();
  } else {
    dateStr = String(dateValue);
  }

  // Handle ISO format dates - extract just the date part (YYYY-MM-DD)
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(dateStr);
  return match ? match[1] : dateStr;
}

/**
 * Normalize a string for fingerprinting
 */
function normalizeString(value: string | undefined | null): string {
  return (value || "").trim().toUpperCase();
}

// extractDividendPerShare is now imported from dividend-utils.ts

/**
 * Activity types where quantity/unitPrice are reliably stored.
 * For cash transactions, the backend stores quantity=0 and unitPrice=0,
 * so we must exclude these from fingerprints for non-trade activities.
 */
const TRADE_ACTIVITY_TYPES = new Set(["BUY", "SELL"]);

/**
 * Activity types that use per-share rate for fingerprinting (from comment/description)
 * This avoids issues where position-based amount calculation differs between sources.
 */
const DIVIDEND_ACTIVITY_TYPES = new Set(["DIVIDEND"]);

/**
 * Activity types where comment should be included in fingerprint
 * to distinguish between multiple transactions of the same type/amount on the same day.
 * (e.g., multiple FX commissions for different trades on the same day)
 */
const COMMENT_IN_FINGERPRINT_TYPES = new Set(["FEE"]);

/**
 * Normalized activity fields for fingerprint creation
 * This interface provides a common structure for both new and existing activities
 */
interface NormalizedActivityFields {
  date: string | Date | undefined;
  symbol: string;
  activityType: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  fee?: number;
  currency?: string;
  comment?: string;
}

/**
 * Internal function to create a fingerprint from normalized fields
 * This is the single source of truth for fingerprint logic, avoiding duplication
 */
function createFingerprintFromNormalized(fields: NormalizedActivityFields): string {
  const activityType = normalizeString(fields.activityType);
  const isTrade = TRADE_ACTIVITY_TYPES.has(activityType);
  const isDividend = DIVIDEND_ACTIVITY_TYPES.has(activityType);

  const parts = [
    normalizeDate(fields.date),
    normalizeString(fields.symbol),
    activityType,
  ];

  if (isTrade) {
    // For trades: use quantity and unitPrice (reliably stored)
    parts.push(normalizeNumber(fields.quantity));
    parts.push(normalizeNumber(fields.unitPrice));
  } else if (isDividend) {
    // For dividends: use per-share rate from comment (consistent across sources)
    // This avoids issues where position-based amount calculation differs
    const perShare = extractDividendPerShare(fields.comment);
    if (perShare !== null) {
      parts.push(normalizeNumber(perShare));
    } else {
      // Fallback to amount if per-share rate not found
      parts.push(normalizeNumber(fields.amount));
    }
  } else {
    // For other cash transactions: use amount only (quantity/unitPrice are stored as 0)
    parts.push(normalizeNumber(fields.amount));
    // For FEE activities, include comment to distinguish multiple fees on same day
    // (e.g., multiple FX commissions for different trades on the same day)
    if (COMMENT_IN_FINGERPRINT_TYPES.has(activityType)) {
      parts.push(normalizeString(fields.comment));
    }
  }

  parts.push(normalizeNumber(fields.fee));
  parts.push(normalizeString(fields.currency));

  return parts.join("|");
}

/**
 * Create a fingerprint for an activity that uniquely identifies it
 *
 * For trade activities (BUY/SELL):
 * - Uses: date, symbol, type, quantity, unitPrice, fee, currency
 *
 * For dividend activities:
 * - Uses: date, symbol, type, perShareRate (from comment), fee, currency
 * - Uses per-share rate instead of amount to avoid position-based calculation differences
 *
 * For other cash activities (TRANSFER_IN, FEE, etc.):
 * - Uses: date, symbol, type, amount, fee, currency
 * - Excludes quantity/unitPrice because backend stores them as 0
 *
 * This ensures the same transaction imported from different sources
 * (Flex Query API vs CSV) will have the same fingerprint.
 */
export function createActivityFingerprint(activity: ActivityImport): string {
  return createFingerprintFromNormalized({
    date: activity.date,
    symbol: activity.symbol,
    activityType: activity.activityType,
    quantity: activity.quantity,
    unitPrice: activity.unitPrice,
    amount: activity.amount,
    fee: activity.fee,
    currency: activity.currency,
    comment: activity.comment,
  });
}

/**
 * Create a fingerprint for an existing activity from the database
 * Uses the same normalization as createActivityFingerprint
 */
export function createExistingActivityFingerprint(activity: {
  activityDate: string;
  assetId: string;
  activityType: string;
  quantity: number;
  unitPrice: number;
  amount?: number;
  fee: number;
  currency: string;
  comment?: string;
}): string {
  return createFingerprintFromNormalized({
    date: activity.activityDate,
    symbol: activity.assetId,
    activityType: activity.activityType,
    quantity: activity.quantity,
    unitPrice: activity.unitPrice,
    amount: activity.amount,
    fee: activity.fee,
    currency: activity.currency,
    comment: activity.comment,
  });
}

/**
 * Filter out duplicate activities based on fingerprints
 *
 * @param newActivities - Activities to import
 * @param existingActivities - Activities already in the database
 * @returns Activities that don't exist in the database
 */
export function filterDuplicateActivities(
  newActivities: ActivityImport[],
  existingActivities: Array<{
    activityDate: string | Date;
    assetId: string;
    activityType: string;
    quantity: number;
    unitPrice: number;
    amount?: number;
    fee: number;
    currency: string;
    comment?: string;
  }>
): { unique: ActivityImport[]; duplicates: ActivityImport[] } {
  // Build set of existing fingerprints
  const existingFingerprints = new Set<string>();
  // For debugging: store both fingerprint and original activity for comparison
  type DebugEntry = { activity: typeof existingActivities[0]; fingerprint: string };
  const existingByDateSymbol = new Map<string, DebugEntry[]>();

  // Debug: Log summary of existing activities
  debug.log(`[Dedup] Comparing ${newActivities.length} new activities against ${existingActivities.length} existing activities`);
  if (existingActivities.length > 0) {
    const sample = existingActivities[0];
    debug.log(`[Dedup] Sample existing activity raw fields:`);
    debug.log(`  activityDate: ${sample.activityDate} (type: ${typeof sample.activityDate})`);
    debug.log(`  assetId: ${sample.assetId}`);
    debug.log(`  activityType: ${sample.activityType}`);
    debug.log(`  quantity: ${sample.quantity}`);
    debug.log(`  unitPrice: ${sample.unitPrice}`);
    debug.log(`  amount: ${sample.amount}`);
    debug.log(`  fee: ${sample.fee}`);
    debug.log(`  currency: ${sample.currency}`);
  }
  if (newActivities.length > 0) {
    const sample = newActivities[0];
    debug.log(`[Dedup] Sample new activity raw fields:`);
    debug.log(`  date: ${sample.date} (type: ${typeof sample.date})`);
    debug.log(`  symbol: ${sample.symbol}`);
    debug.log(`  activityType: ${sample.activityType}`);
    debug.log(`  quantity: ${sample.quantity}`);
    debug.log(`  unitPrice: ${sample.unitPrice}`);
    debug.log(`  amount: ${sample.amount}`);
    debug.log(`  fee: ${sample.fee}`);
    debug.log(`  currency: ${sample.currency}`);
  }

  for (const activity of existingActivities) {
    // Normalize activityDate to string before creating fingerprint
    const normalizedActivity = {
      ...activity,
      activityDate: formatDateToISO(activity.activityDate),
    };
    const fingerprint = createExistingActivityFingerprint(normalizedActivity);
    existingFingerprints.add(fingerprint);

    // Track by date+symbol for debugging
    const key = `${normalizeDate(activity.activityDate)}|${normalizeString(activity.assetId)}`;
    const existingEntries = existingByDateSymbol.get(key);
    if (existingEntries) {
      existingEntries.push({ activity, fingerprint });
    } else {
      existingByDateSymbol.set(key, [{ activity, fingerprint }]);
    }
  }

  const unique: ActivityImport[] = [];
  const duplicates: ActivityImport[] = [];

  // Also track fingerprints within the new activities to handle
  // duplicates within the same import batch
  const newFingerprints = new Set<string>();

  let debugLogCount = 0;

  for (const activity of newActivities) {
    const fingerprint = createActivityFingerprint(activity);

    if (existingFingerprints.has(fingerprint) || newFingerprints.has(fingerprint)) {
      duplicates.push(activity);
    } else {
      // Debug: Log why it's not matching - show field-by-field comparison
      if (debugLogCount < MAX_DEBUG_LOGS) {
        const key = `${normalizeDate(activity.date)}|${normalizeString(activity.symbol)}`;
        const existingMatches = existingByDateSymbol.get(key);
        if (existingMatches && existingMatches.length > 0) {
          const existing = existingMatches[0].activity;
          debug.log(`[Dedup Debug] Activity NOT matched despite same date+symbol:`);
          debug.log(`  Date: new="${normalizeDate(activity.date)}" vs existing="${normalizeDate(existing.activityDate)}"`);
          debug.log(`  Symbol: new="${normalizeString(activity.symbol)}" vs existing="${normalizeString(existing.assetId)}"`);
          debug.log(`  Type: new="${normalizeString(activity.activityType)}" vs existing="${normalizeString(existing.activityType)}"`);
          debug.log(`  Qty: new="${normalizeNumber(activity.quantity)}" vs existing="${normalizeNumber(existing.quantity)}"`);
          debug.log(`  UnitPrice: new="${normalizeNumber(activity.unitPrice)}" vs existing="${normalizeNumber(existing.unitPrice)}"`);
          debug.log(`  Amount: new="${normalizeNumber(activity.amount)}" vs existing="${normalizeNumber(existing.amount)}"`);
          debug.log(`  Fee: new="${normalizeNumber(activity.fee)}" vs existing="${normalizeNumber(existing.fee)}"`);
          debug.log(`  Currency: new="${normalizeString(activity.currency)}" vs existing="${normalizeString(existing.currency)}"`);
          debugLogCount++;
        }
      }

      unique.push(activity);
      newFingerprints.add(fingerprint);
    }
  }

  return { unique, duplicates };
}

/**
 * Deduplicate activities before import
 *
 * This is the main function to use before calling activities.import()
 * It fetches existing activities and filters out duplicates.
 *
 * @param newActivities - Activities to import
 * @param accountId - Account ID to check for existing activities
 * @param getExistingActivities - Function to fetch existing activities
 * @returns Object with unique activities to import and count of duplicates skipped
 */
export async function deduplicateActivities(
  newActivities: ActivityImport[],
  accountId: string,
  getExistingActivities: (accountId: string) => Promise<Array<{
    activityDate: string;
    assetId: string;
    activityType: string;
    quantity: number;
    unitPrice: number;
    amount?: number;
    fee: number;
    currency: string;
    comment?: string;
  }>>
): Promise<{ toImport: ActivityImport[]; duplicatesSkipped: number }> {
  if (newActivities.length === 0) {
    return { toImport: [], duplicatesSkipped: 0 };
  }

  // Fetch existing activities for the account
  const existingActivities = await getExistingActivities(accountId);

  // Filter out duplicates
  const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

  if (duplicates.length > 0) {
    debug.log(`[Deduplication] Skipping ${duplicates.length} duplicate activities for account ${accountId}`);
  }

  return {
    toImport: unique,
    duplicatesSkipped: duplicates.length,
  };
}

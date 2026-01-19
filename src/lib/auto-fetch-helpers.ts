/**
 * Auto-fetch helper functions
 *
 * Helper utilities for the auto-fetch functionality.
 * These are extracted to improve testability and reduce the complexity
 * of the main performAutoFetch function.
 */

import { FETCH_COOLDOWN_MS } from "./constants";

/**
 * Check if a config is still in cooldown period
 * @returns true if still in cooldown (should skip), false if ready to fetch
 */
export function isConfigInCooldown(lastFetchTime: string | undefined): {
  inCooldown: boolean;
  hoursRemaining?: number;
} {
  if (!lastFetchTime) {
    return { inCooldown: false };
  }

  const lastFetchMs = new Date(lastFetchTime).getTime();

  // Invalid date - not in cooldown
  if (isNaN(lastFetchMs)) {
    return { inCooldown: false };
  }

  const timeSince = Date.now() - lastFetchMs;
  if (timeSince < FETCH_COOLDOWN_MS) {
    const hoursRemaining = Math.round(((FETCH_COOLDOWN_MS - timeSince) / (60 * 60 * 1000)) * 10) / 10;
    return { inCooldown: true, hoursRemaining };
  }

  return { inCooldown: false };
}

/**
 * Create activity fingerprint getter for deduplication
 * This creates a function that fetches existing activities and maps them
 * to the fingerprint format expected by deduplicateActivities
 */
export function createActivityFingerprintGetter(
  activitiesApi: { getAll: (accountId: string) => Promise<any[]> }
): (accountId: string) => Promise<{
  activityDate: string;
  assetId: string;
  activityType: string;
  quantity: number;
  unitPrice: number;
  amount?: number;
  fee: number;
  currency: string;
  comment?: string;
}[]> {
  return async (accountId: string) => {
    const activities = await activitiesApi.getAll(accountId);
    return activities.map((a) => ({
      // Convert Date to ISO string for deduplication fingerprinting
      activityDate: a.date instanceof Date ? a.date.toISOString().split("T")[0] : String(a.date),
      assetId: a.assetSymbol, // Use assetSymbol (ticker) not assetId (internal ID)
      activityType: a.activityType,
      quantity: a.quantity,
      unitPrice: a.unitPrice,
      amount: a.amount,
      fee: a.fee,
      currency: a.currency,
      comment: a.comment, // Include comment for dividend per-share fingerprinting
    }));
  };
}

/**
 * Update config status after fetch attempt
 */
export interface ConfigStatusUpdate {
  lastFetchTime: string;
  lastFetchStatus: "success" | "error";
  lastFetchError?: string;
}

export function createSuccessStatus(): ConfigStatusUpdate {
  return {
    lastFetchTime: new Date().toISOString(),
    lastFetchStatus: "success",
    lastFetchError: undefined,
  };
}

export function createErrorStatus(error: unknown): ConfigStatusUpdate {
  return {
    lastFetchTime: new Date().toISOString(),
    lastFetchStatus: "error",
    lastFetchError: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Format import result message
 */
export function formatImportResultMessage(
  imported: number,
  skipped: number
): string {
  const skippedMsg = skipped > 0 ? `, ${skipped} duplicates skipped` : "";
  return `${imported} transactions imported${skippedMsg}`;
}

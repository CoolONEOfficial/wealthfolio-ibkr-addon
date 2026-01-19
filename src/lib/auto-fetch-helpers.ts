/**
 * Auto-fetch helper functions
 *
 * Helper utilities for the auto-fetch functionality.
 * These are extracted to improve testability and reduce the complexity
 * of the main performAutoFetch function.
 */

import { FETCH_COOLDOWN_MS, MS_PER_HOUR } from "./constants";
import { formatDateToISO, getErrorMessage } from "./shared-utils";
import { debug } from "./debug-logger";
import type { ActivityDetails } from "@wealthfolio/addon-sdk";

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
  const now = Date.now();

  // Invalid date - allow fetch but log warning
  if (isNaN(lastFetchMs)) {
    debug.warn(`[IBKR Auto-fetch] Invalid timestamp "${lastFetchTime}", allowing fetch`);
    return { inCooldown: false };
  }

  // Future timestamp is suspicious (clock skew or manipulation)
  // Conservative approach: treat as in cooldown to prevent potential abuse
  if (lastFetchMs > now) {
    debug.warn(`[IBKR Auto-fetch] Future timestamp detected (${lastFetchTime}), treating as in cooldown`);
    return { inCooldown: true, hoursRemaining: FETCH_COOLDOWN_MS / MS_PER_HOUR };
  }

  const timeSince = now - lastFetchMs;
  if (timeSince < FETCH_COOLDOWN_MS) {
    const hoursRemaining = Math.round(((FETCH_COOLDOWN_MS - timeSince) / MS_PER_HOUR) * 10) / 10;
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
  activitiesApi: { getAll: (accountId: string) => Promise<ActivityDetails[]> }
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
      activityDate: formatDateToISO(a.date),
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

/**
 * Create a "pending" status to claim the config before fetching.
 * This prevents TOCTOU race conditions by putting the config in cooldown
 * immediately, before the actual fetch begins.
 */
export function createPendingStatus(): ConfigStatusUpdate {
  return {
    lastFetchTime: new Date().toISOString(),
    lastFetchStatus: "success", // Use "success" since "pending" isn't a valid status
    lastFetchError: undefined,
  };
}

export function createErrorStatus(error: unknown): ConfigStatusUpdate {
  return {
    lastFetchTime: new Date().toISOString(),
    lastFetchStatus: "error",
    lastFetchError: getErrorMessage(error),
  };
}

/**
 * Format import result message
 */
export function formatImportResultMessage(
  imported: number,
  skipped: number,
  failed: number = 0
): string {
  const parts: string[] = [`${imported} transactions imported`];
  if (skipped > 0) {
    parts.push(`${skipped} duplicates skipped`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  return parts.join(", ");
}

/**
 * User-friendly error messages for common IBKR Flex API errors.
 * These messages provide actionable guidance for resolving issues.
 */
const IBKR_ERROR_GUIDANCE: Record<string, string> = {
  // Token issues
  "Token has expired": "Token has expired. Generate a new token in IBKR Account Management → Reports → Flex Queries → Configure Flex Token.",
  "Token is invalid": "Token is invalid. Check your Flex Query token in IBKR Account Management → Reports → Flex Queries.",
  // IP restriction
  "IP address restriction violated": "IP address not allowed. Update IP restrictions in IBKR Account Management → Reports → Flex Queries → Configure Flex Token.",
  "IP address not allowed": "IP address not allowed. Update IP restrictions in IBKR Account Management → Reports → Flex Queries → Configure Flex Token.",
  // Query issues
  "Query is invalid": "Query ID is invalid. Verify the Flex Query ID in IBKR Account Management → Reports → Flex Queries.",
  // Permissions
  "Token missing permissions": "Token lacks required permissions. Regenerate the token with proper permissions in IBKR Account Management.",
};

/**
 * Enrich an IBKR error message with user-friendly guidance.
 * If no specific guidance is available, returns the original message.
 */
export function enrichIBKRErrorMessage(errorMessage: string): string {
  // Check for exact matches first
  if (IBKR_ERROR_GUIDANCE[errorMessage]) {
    return IBKR_ERROR_GUIDANCE[errorMessage];
  }

  // Check for partial matches (error messages might be wrapped)
  for (const [key, guidance] of Object.entries(IBKR_ERROR_GUIDANCE)) {
    if (errorMessage.includes(key)) {
      return guidance;
    }
  }

  return errorMessage;
}

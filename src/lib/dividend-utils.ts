/**
 * Dividend Parsing Utilities
 *
 * Shared utilities for parsing dividend information from IBKR activity descriptions.
 * Used by both activity-converter (for imports) and activity-deduplicator (for fingerprinting).
 */

/**
 * Parsed dividend information
 */
export interface DividendInfo {
  /** Dividend currency (e.g., "USD", "GBP", "NOK") */
  currency: string;
  /** Per-share dividend amount */
  perShare: number;
}

/**
 * Parse dividend currency and per-share amount from IBKR activity description
 *
 * Examples of supported formats:
 * - "O(US7561091049) Cash Dividend USD 0.264 per Share (Ordinary Dividend)"
 * - "SUPR(GB00BF345X11) Cash Dividend GBP 0.0153 per Share"
 * - "BAKKA(NO0010597883) Cash Dividend NOK 13.37347 per Share"
 * - "101 (HK0101000591) Cash Dividend HKD 0.40 (Ordinary Dividend)" (no "per Share")
 *
 * @param activityDescription - The IBKR activity description string
 * @returns Parsed dividend info or null if not parseable
 */
export function parseDividendInfo(activityDescription: string | undefined | null): DividendInfo | null {
  if (!activityDescription) return null;

  // Try format with "per Share"
  // Pattern: "Cash Dividend XXX N.NNN per Share"
  let match = /Cash Dividend ([A-Z]{3}) ([\d.]+) per Share/i.exec(activityDescription);
  if (match) {
    return {
      currency: match[1],
      perShare: parseFloat(match[2]),
    };
  }

  // Try format without "per Share" (e.g., "Cash Dividend HKD 0.40 (Ordinary")
  // Pattern: "Cash Dividend XXX N.NN" followed by space or (
  match = /Cash Dividend ([A-Z]{3}) ([\d.]+)(?:\s|\()/i.exec(activityDescription);
  if (match) {
    return {
      currency: match[1],
      perShare: parseFloat(match[2]),
    };
  }

  return null;
}

/**
 * Extract only the per-share dividend rate from an IBKR activity description
 *
 * This is a convenience wrapper around parseDividendInfo that returns just the rate.
 * Useful for deduplication fingerprinting where only the rate is needed.
 *
 * @param activityDescription - The IBKR activity description string
 * @returns Per-share rate or null if not parseable
 */
export function extractDividendPerShare(activityDescription: string | undefined | null): number | null {
  const info = parseDividendInfo(activityDescription);
  return info?.perShare ?? null;
}

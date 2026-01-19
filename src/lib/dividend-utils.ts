/**
 * Dividend Parsing Utilities
 *
 * Shared utilities for parsing dividend information from IBKR activity descriptions.
 * Used by both activity-converter (for imports) and activity-deduplicator (for fingerprinting).
 */

import { MAX_REASONABLE_DIVIDEND_PER_SHARE } from "./constants";

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

  // Normalize whitespace (handle multiple spaces, tabs, etc.)
  const normalized = activityDescription.replace(/\s+/g, " ").trim();

  // Try format with "per Share" (most common)
  // Pattern: "Cash Dividend XXX N.NNN per Share"
  // Currency: 2-4 uppercase letters to handle standard (USD, EUR) and special cases (USDT, etc.)
  let match = /Cash Dividend ([A-Z]{2,4}) ([\d.]+) per Share/i.exec(normalized);
  if (match) {
    const result = validateAndCreateResult(match[1], match[2]);
    if (result) return result;
  }

  // Try format without "per Share" (e.g., "Cash Dividend HKD 0.40 (Ordinary")
  // Pattern: "Cash Dividend XXX N.NN" followed by space, ( or end of string
  match = /Cash Dividend ([A-Z]{2,4}) ([\d.]+)(?:\s|\(|$)/i.exec(normalized);
  if (match) {
    const result = validateAndCreateResult(match[1], match[2]);
    if (result) return result;
  }

  // Try more flexible format for edge cases
  // Pattern: Any "Dividend" followed by currency and amount
  match = /Dividend[^A-Z]*([A-Z]{2,4})\s+([\d.]+)/i.exec(normalized);
  if (match) {
    const result = validateAndCreateResult(match[1], match[2]);
    if (result) return result;
  }

  return null;
}

/**
 * Validate parsed values and create DividendInfo if valid
 */
function validateAndCreateResult(currency: string, amountStr: string): DividendInfo | null {
  // Validate currency is uppercase
  const normalizedCurrency = currency.toUpperCase();

  // Parse and validate amount
  const perShare = parseFloat(amountStr);

  // Reject invalid amounts
  if (isNaN(perShare) || perShare <= 0) {
    return null;
  }

  // Reject unreasonably large amounts (likely parsing error)
  if (perShare > MAX_REASONABLE_DIVIDEND_PER_SHARE) {
    return null;
  }

  return {
    currency: normalizedCurrency,
    perShare,
  };
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

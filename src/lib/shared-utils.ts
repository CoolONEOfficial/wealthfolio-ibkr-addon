/**
 * Shared Utility Functions
 *
 * Common utility functions used across multiple modules to reduce code duplication.
 */

/**
 * Cash symbol prefix used for cash transactions
 */
export const CASH_SYMBOL_PREFIX = "$CASH-";

/**
 * Create a cash symbol for a given currency
 *
 * @param currency - The currency code (e.g., "USD", "EUR", "GBP")
 * @returns Cash symbol in format "$CASH-XXX"
 *
 * @example
 * createCashSymbol("USD") // returns "$CASH-USD"
 * createCashSymbol("GBP") // returns "$CASH-GBP"
 */
export function createCashSymbol(currency: string): string {
  return `${CASH_SYMBOL_PREFIX}${currency}`;
}

/**
 * Check if a symbol is a cash symbol
 *
 * @param symbol - The symbol to check
 * @returns true if the symbol is a cash symbol
 */
export function isCashSymbol(symbol: string | undefined | null): boolean {
  return symbol?.startsWith(CASH_SYMBOL_PREFIX) ?? false;
}

/**
 * Extract currency from a cash symbol
 *
 * @param symbol - The cash symbol (e.g., "$CASH-USD")
 * @returns The currency code or null if not a cash symbol
 */
export function getCurrencyFromCashSymbol(symbol: string | undefined | null): string | null {
  if (!symbol || !symbol.startsWith(CASH_SYMBOL_PREFIX)) {
    return null;
  }
  return symbol.slice(CASH_SYMBOL_PREFIX.length);
}

/**
 * Safely extract an error message from an unknown error value
 *
 * Handles Error objects, strings, and other types gracefully.
 *
 * @param error - The error value (could be Error, string, or anything)
 * @returns A string error message
 *
 * @example
 * getErrorMessage(new Error("Something went wrong")) // returns "Something went wrong"
 * getErrorMessage("Just a string") // returns "Just a string"
 * getErrorMessage({ code: 500 }) // returns "[object Object]"
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Format a Date or date string to ISO date format (YYYY-MM-DD)
 *
 * @param date - A Date object or date string
 * @returns ISO date string (YYYY-MM-DD) or the original string if not a Date
 *
 * @example
 * formatDateToISO(new Date("2024-03-15T10:30:00Z")) // returns "2024-03-15"
 * formatDateToISO("2024-03-15") // returns "2024-03-15"
 */
export function formatDateToISO(date: Date | string | undefined | null): string {
  if (!date) {
    return "";
  }
  if (date instanceof Date) {
    return date.toISOString().split("T")[0];
  }
  // If it's already a string, return as-is (assume it's already formatted)
  return String(date);
}

/**
 * Minimum number of columns required for valid CSV headers
 */
const MIN_HEADER_COLUMNS = 3;

/**
 * Validate CSV headers are well-formed
 *
 * Checks that headers array has minimum columns and no empty values.
 *
 * @param headers - Array of header strings
 * @returns true if headers are valid
 *
 * @example
 * validateCsvHeaders(["Date", "Symbol", "Amount"]) // returns true
 * validateCsvHeaders(["Date", "", "Amount"]) // returns false (empty header)
 * validateCsvHeaders(["A", "B"]) // returns false (too few columns)
 */
export function validateCsvHeaders(headers: string[]): boolean {
  return (
    headers.length >= MIN_HEADER_COLUMNS &&
    !headers.some((header) => !header || header.trim() === "")
  );
}

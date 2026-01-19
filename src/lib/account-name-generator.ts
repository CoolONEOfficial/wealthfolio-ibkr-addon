/**
 * Generates account names for multi-currency IBKR import
 * Creates one account per currency with format: "{groupName} - {currency}"
 *
 * @param groupName - The account group name (e.g., "Plain")
 * @param currencies - Array of currency codes (e.g., ["USD", "EUR", "GBP"])
 * @returns Array of account data objects with currency, name, and group
 */
export function generateAccountNames(
  groupName: string,
  currencies: string[]
): Array<{ currency: string; name: string; group: string }> {
  return currencies.map((currency) => ({
    currency,
    name: `${groupName} - ${currency}`,
    group: groupName,
  }));
}

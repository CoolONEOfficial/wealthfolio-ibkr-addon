/**
 * Map exchange codes to their trading currencies
 * IBKR uses ListingExchange to indicate where a security is traded
 */
export const EXCHANGE_TO_CURRENCY: Record<string, string> = {
  // US Exchanges
  "NYSE": "USD",
  "NASDAQ": "USD",
  "AMEX": "USD",
  "ARCA": "USD",
  "BATS": "USD",
  "IEX": "USD",
  "CBOE": "USD",
  "PINK": "USD",      // OTC Pink Sheets (for ADRs like HESAY)

  // UK Exchanges
  "LSE": "GBP",
  "LSEIOB1": "GBP",

  // European Exchanges
  "EBS": "CHF",      // Swiss (Zurich)
  "SBF": "EUR",      // Euronext Paris
  "AEB": "EUR",      // Euronext Amsterdam
  "BVME": "EUR",     // Borsa Italiana
  "FWB": "EUR",      // Frankfurt
  "IBIS": "EUR",     // Xetra

  // Asian Exchanges
  "SEHK": "HKD",     // Hong Kong
  "TSE": "JPY",      // Tokyo
  "SGX": "SGD",      // Singapore

  // Australian Exchange
  "ASX": "AUD",

  // Scandinavian Exchanges
  "OSE": "NOK",      // Oslo
  "SFB": "SEK",      // Stockholm
  "KFB": "DKK",      // Copenhagen

  // Canadian Exchange
  "TSX": "CAD",
  "VENTURE": "CAD",
};

/**
 * Get currency for an exchange code
 * @param exchange - The IBKR exchange code (e.g., "NYSE", "LSE")
 * @returns The currency code or undefined if unknown
 */
export function getCurrencyForExchange(exchange: string | undefined | null): string | undefined {
  if (!exchange) return undefined;
  return EXCHANGE_TO_CURRENCY[exchange.trim()];
}

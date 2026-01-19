import type { ActivityImport } from "@wealthfolio/addon-sdk";
import { EXCHANGE_TO_CURRENCY } from "./exchange-utils";
import type { AccountPreview } from "../types";

/**
 * Activity Converter Service
 *
 * Converts processed IBKR CSV data to ActivityImport format
 * for import into Wealthfolio
 */

/**
 * Parse original currency and per-share amount from IBKR dividend ActivityDescription
 *
 * Examples:
 * - "O(US7561091049) Cash Dividend USD 0.264 per Share (Ordinary Dividend)"
 * - "SUPR(GB00BF345X11) Cash Dividend GBP 0.0153 per Share"
 * - "BAKKA(NO0010597883) Cash Dividend NOK 13.37347 per Share"
 * - "101 (HK0101000591) Cash Dividend HKD 0.40 (Ordinary Dividend)" (no "per Share")
 *
 * Returns: { currency: string, perShare: number } or null if not parseable
 */
function parseDividendInfo(activityDescription: string): { currency: string; perShare: number } | null {
  // Try format with "per Share"
  let match = /Cash Dividend ([A-Z]{3}) ([\d.]+) per Share/i.exec(activityDescription);
  if (match) {
    return {
      currency: match[1],
      perShare: parseFloat(match[2])
    };
  }

  // Try format without "per Share" (e.g., "Cash Dividend HKD 0.40 (Ordinary")
  // Pattern: "Cash Dividend XXX N.NN" followed by space or (
  match = /Cash Dividend ([A-Z]{3}) ([\d.]+)(?:\s|\()/i.exec(activityDescription);
  if (match) {
    return {
      currency: match[1],
      perShare: parseFloat(match[2])
    };
  }

  return null;
}

/**
 * Map IBKR activity types to Wealthfolio activity types
 */
function mapActivityType(ibkrType: string): string {
  const mapping: Record<string, string> = {
    "IBKR_BUY": "BUY",
    "IBKR_SELL": "SELL",
    "IBKR_DIVIDEND": "DIVIDEND",
    "IBKR_TAX": "TAX",
    "IBKR_FEE": "FEE",
    "IBKR_DEPOSIT": "DEPOSIT",
    "IBKR_WITHDRAWAL": "WITHDRAWAL",
    "IBKR_TRANSFER_IN": "TRANSFER_IN",
    "IBKR_TRANSFER_OUT": "TRANSFER_OUT",
    "IBKR_INTEREST": "INTEREST",
  };

  return mapping[ibkrType] || "UNKNOWN";
}

/**
 * Parse numeric value from CSV string
 */
function parseNumeric(value: any): number {
  if (typeof value === "number") return value;
  if (!value) return 0;

  const str = String(value).replace(/[^0-9.-]/g, "");
  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Position entry with date for historical position lookup
 */
interface PositionEntry {
  date: string;
  quantity: number;
}

/**
 * Build position history from BUY/SELL transactions.
 * Used to look up position quantity at dividend date for accurate dividend calculation.
 *
 * Returns a map: symbol -> PositionEntry[] sorted by date
 * Each entry represents the cumulative position after a trade on that date.
 */
function buildPositionHistory(processedData: any[]): Map<string, PositionEntry[]> {
  const history = new Map<string, PositionEntry[]>();

  // Sort transactions by date first
  const trades = processedData
    .filter((row) => row._IBKR_TYPE === "IBKR_BUY" || row._IBKR_TYPE === "IBKR_SELL")
    .sort((a, b) => {
      const dateA = a.Date || a.TradeDate || "";
      const dateB = b.Date || b.TradeDate || "";
      return dateA.localeCompare(dateB);
    });

  // Track running position for each symbol
  const currentPosition = new Map<string, number>();

  for (const row of trades) {
    const symbol = (row.Symbol || "").toUpperCase();
    if (!symbol) continue;

    const quantity = parseNumeric(row.Quantity);
    const isBuy = row._IBKR_TYPE === "IBKR_BUY";
    const date = row.Date || row.TradeDate || "";

    // Update running position
    const prevPosition = currentPosition.get(symbol) || 0;
    const newPosition = isBuy ? prevPosition + quantity : prevPosition - quantity;
    currentPosition.set(symbol, newPosition);

    // Record position entry
    if (!history.has(symbol)) {
      history.set(symbol, []);
    }
    history.get(symbol)!.push({ date, quantity: newPosition });
  }

  return history;
}

/**
 * Get position quantity for a symbol at a specific date.
 * Returns the position as of the most recent trade on or before the given date.
 */
function getPositionAtDate(
  positionHistory: Map<string, PositionEntry[]>,
  symbol: string,
  date: string
): number {
  const entries = positionHistory.get(symbol.toUpperCase());
  if (!entries || entries.length === 0) return 0;

  // Find the most recent entry on or before the date
  let position = 0;
  for (const entry of entries) {
    if (entry.date <= date) {
      position = entry.quantity;
    } else {
      break;
    }
  }

  return position;
}

/**
 * FX Rate entry with date for closest-date lookup
 */
interface FXRateEntry {
  date: string;
  rate: number; // e.g., 1.33 means 1 GBP = 1.33 USD
}

/**
 * Build FX rate lookup from FX trades in the raw data.
 *
 * Must be called with RAW CSV data (before preprocessing) because
 * preprocessing converts FX trades to TRANSFER_IN/TRANSFER_OUT pairs,
 * losing the exchange rate information.
 *
 * FX trades have:
 * - Symbol like "GBP.USD" (base.quote)
 * - TradePrice containing the exchange rate
 * - TradeDate or ReportDate for the trade date
 * - LevelOfDetail = "EXECUTION" for the actual trade rows
 *
 * Returns a map: "BASE/QUOTE" -> FXRateEntry[] sorted by date
 * e.g., "GBP/USD" -> [{date: "2025-05-07", rate: 1.33}, ...]
 */
export function buildFXRateLookup(rawData: any[]): Map<string, FXRateEntry[]> {
  const lookup = new Map<string, FXRateEntry[]>();

  for (const row of rawData) {
    // FX trades have Symbol like "GBP.USD" and LevelOfDetail = "EXECUTION"
    if (!row.Symbol || !row.Symbol.includes(".")) continue;
    if (row.LevelOfDetail !== "EXECUTION") continue;

    const parts = row.Symbol.split(".");
    if (parts.length !== 2) continue;

    const [base, quote] = parts;
    const tradePrice = parseNumeric(row.TradePrice);

    // Skip invalid prices
    if (tradePrice <= 0 || tradePrice > 1000) continue;

    const date = row.TradeDate || row.ReportDate || row.Date || "";
    if (!date) continue;

    // Normalize date format (remove time portion if present)
    const normalizedDate = date.split(" ")[0];

    const key = `${base}/${quote}`;
    if (!lookup.has(key)) {
      lookup.set(key, []);
    }
    lookup.get(key)!.push({ date: normalizedDate, rate: tradePrice });

    // Also store inverse for reverse lookup
    const inverseKey = `${quote}/${base}`;
    if (!lookup.has(inverseKey)) {
      lookup.set(inverseKey, []);
    }
    lookup.get(inverseKey)!.push({ date: normalizedDate, rate: 1 / tradePrice });
  }

  // Sort each array by date
  for (const [, entries] of lookup) {
    entries.sort((a, b) => a.date.localeCompare(b.date));
  }

  return lookup;
}

/**
 * Get the FX rate for converting from base currency to target currency.
 * Uses the closest rate by date (prefers earlier or same date).
 *
 * @returns The rate to multiply base amount by to get target amount, or null if not found
 */
function getFXRate(
  lookup: Map<string, FXRateEntry[]>,
  baseCurrency: string,
  targetCurrency: string,
  date: string
): number | null {
  const key = `${baseCurrency}/${targetCurrency}`;
  const entries = lookup.get(key);

  if (!entries || entries.length === 0) return null;

  const normalizedDate = date.split(" ")[0];

  // Find the closest rate by date (prefer same date or earlier)
  let closest: FXRateEntry | null = null;
  for (const entry of entries) {
    if (entry.date <= normalizedDate) {
      closest = entry;
    } else if (!closest) {
      // Use first future rate if no earlier rates exist
      closest = entry;
      break;
    } else {
      break;
    }
  }

  return closest?.rate ?? null;
}

/**
 * Parse transaction tax amount from TTAX description
 *
 * TTAX descriptions have format: "French Daily Trade Charge Tax HESAY 6"
 * where "6" is the actual tax amount in the original currency (USD).
 * The Amount column contains the base currency equivalent.
 *
 * @returns The original currency amount or null if not parseable
 */
function parseTTAXAmount(description: string): number | null {
  // Match the last number in the description
  // e.g., "French Daily Trade Charge Tax HESAY 6" -> 6
  // e.g., "French Daily Trade Charge Tax HESAY 1.5" -> 1.5
  const match = /\s([\d.]+)$/.exec(description);
  if (match) {
    const amount = parseFloat(match[1]);
    if (!isNaN(amount)) {
      return amount;
    }
  }
  return null;
}

/**
 * Determine the actual transaction currency
 *
 * IBKR exports show CurrencyPrimary as the base currency for ALL transactions,
 * so we need to determine the actual currency from other fields.
 *
 * Logic:
 * 1. For FX conversions (Symbol contains "."): Parse the currency pair
 * 2. For stock trades: Map the ListingExchange to currency
 * 3. For transaction taxes (TTAX): Use ListingExchange (tax is in security's trading currency)
 * 4. For other cash transactions: Use the base currency (CurrencyPrimary)
 */
function determineTransactionCurrency(row: any, baseCurrency: string): string {
  const ibkrType = row._IBKR_TYPE || "";
  const activityCode = row.ActivityCode || "";

  // For transaction taxes (TTAX), use the security's trading currency
  // TTAX rows have Amount in the original currency (e.g., USD for HESAY French FTT)
  // even though CurrencyPrimary is the account's base currency
  if (activityCode === "TTAX" && row.ListingExchange && EXCHANGE_TO_CURRENCY[row.ListingExchange]) {
    return EXCHANGE_TO_CURRENCY[row.ListingExchange];
  }

  // For OFEE (Other Fees) with ListingExchange, these are dividend-related ADR fees
  // The fee is in the security's trading currency, not the base currency
  if (activityCode === "OFEE" && row.ListingExchange && EXCHANGE_TO_CURRENCY[row.ListingExchange]) {
    return EXCHANGE_TO_CURRENCY[row.ListingExchange];
  }

  // For most cash transactions (transfers, deposits, withdrawals, fees, interest, dividends, taxes),
  // use CurrencyPrimary directly - the preprocessor sets this correctly
  if (
    ibkrType.includes("TRANSFER") ||
    ibkrType.includes("DEPOSIT") ||
    ibkrType.includes("WITHDRAWAL") ||
    ibkrType.includes("FEE") ||
    ibkrType.includes("INTEREST") ||
    ibkrType.includes("DIVIDEND") ||
    ibkrType.includes("TAX")
  ) {
    return baseCurrency;
  }

  // FX conversions: Symbol is like "GBP.USD", "EUR.USD", etc.
  if (row.Symbol && row.Symbol.includes('.')) {
    const parts = row.Symbol.split('.');
    if (parts.length === 2) {
      // For FX, we'll handle this specially in the FX splitter
      // For now, return base currency (will be overridden by splitter)
      return baseCurrency;
    }
  }

  // Stock trades: Use exchange-to-currency mapping
  if (row.ListingExchange && EXCHANGE_TO_CURRENCY[row.ListingExchange]) {
    return EXCHANGE_TO_CURRENCY[row.ListingExchange];
  }

  // Fallback: Use base currency from CurrencyPrimary
  return baseCurrency;
}

/**
 * Convert IBKR CSV rows to ActivityImport format
 */
export async function convertToActivityImports(
  // Using 'any' for processedData as it contains dynamically-keyed CSV row data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processedData: any[],
  accountPreviews: AccountPreview[]
): Promise<ActivityImport[]> {
  const activities: ActivityImport[] = [];

  // Build FX rate lookup from FX trades for currency conversion
  const fxLookup = buildFXRateLookup(processedData);

  // Build position history from BUY/SELL trades for dividend calculation
  const positionHistory = buildPositionHistory(processedData);

  for (const row of processedData) {
    try {
      const baseCurrency = row.CurrencyPrimary || "USD";
      const ibkrType = row._IBKR_TYPE || "UNKNOWN";
      const activityType = mapActivityType(ibkrType);

      // Field names from ibkr-preprocessor.ts:
      // - Quantity (for trade shares)
      // - TradePrice (for unit price)
      // - TradeMoney (for cash amounts in deposits/withdrawals/dividends)
      // - IBCommission (for fees)
      const quantity = parseNumeric(row.Quantity) || 0;
      const unitPrice = parseNumeric(row.TradePrice) || 0;

      // Calculate amount based on transaction type
      let amount = 0;
      let fee = 0;
      let currency = determineTransactionCurrency(row, baseCurrency);

      if (ibkrType === "IBKR_BUY" || ibkrType === "IBKR_SELL") {
        // For trades: calculate from quantity * unit_price
        amount = Math.abs(quantity * unitPrice);
        // Fee includes both commission (IBCommission) and any transaction taxes (Taxes field)
        // Transaction taxes include things like HK stamp duty, which is in the trade's Taxes column
        fee = Math.abs(parseNumeric(row.IBCommission)) + Math.abs(parseNumeric(row.Taxes));
      } else if (ibkrType === "IBKR_DIVIDEND") {
        // For dividends: Calculate amount from per-share × position quantity
        //
        // At BaseCurrency level, TradeMoney is in the base currency (e.g., GBP),
        // but the dividend was actually paid in the original currency (e.g., USD).
        // Using FX rates to convert is unreliable (rates often not available).
        //
        // Better approach: Calculate from per-share amount × position quantity
        // - Parse per-share from description (e.g., "Cash Dividend USD 0.264 per Share")
        // - Look up position quantity at dividend date from position history
        // - amount = perShare × position
        //
        const activityDesc = row.ActivityDescription || "";
        const dividendInfo = parseDividendInfo(activityDesc);
        const txDate = row.Date || row.ReportDate || row.TradeDate || "";
        const symbol = (row.Symbol || "").toUpperCase();

        if (dividendInfo) {
          currency = dividendInfo.currency;

          // If dividend currency matches base currency, TradeMoney is already correct
          if (currency === baseCurrency) {
            amount = Math.abs(parseNumeric(row.TradeMoney));
          } else {
            // Dividend is in a different currency than base (e.g., USD dividend, GBP base)
            // TradeMoney is in base currency, so we need to convert to original currency
            //
            // Preferred method: Calculate from per-share × position quantity
            const position = getPositionAtDate(positionHistory, symbol, txDate);

            if (position > 0 && dividendInfo.perShare > 0) {
              // Calculate: amount = position × perShare
              amount = position * dividendInfo.perShare;
            } else {
              // Fallback to FX conversion if position unknown
              const fxRate = getFXRate(fxLookup, baseCurrency, currency, txDate);
              if (fxRate && fxRate > 0) {
                amount = Math.abs(parseNumeric(row.TradeMoney)) * fxRate;
              } else {
                // Last resort: use TradeMoney as-is (will be in base currency - incorrect but logged)
                amount = Math.abs(parseNumeric(row.TradeMoney));
                console.warn(`No FX rate or position for ${baseCurrency}/${currency} dividend: ${symbol} on ${txDate}, amount may be incorrect`);
              }
            }
          }
        } else {
          // Couldn't parse currency from description, use base currency
          amount = Math.abs(parseNumeric(row.TradeMoney));
        }
        fee = 0;
      } else if (ibkrType === "IBKR_TAX") {
        // For taxes: Calculate amount from per-share × position × tax_rate
        // Similar to dividends, TradeMoney is in base currency for BaseCurrency level rows.
        //
        // Tax descriptions have format: "SYMBOL(ISIN) CASH DIVIDEND XXX N.NN PER SHARE - CC TAX"
        // The tax is typically a percentage of the dividend (e.g., 15% US WHT).
        // We calculate the tax by first calculating the dividend, then applying the tax ratio.
        //
        const activityDesc = row.ActivityDescription || row.Description || "";
        const dividendInfo = parseDividendInfo(activityDesc);
        const txDate = row.Date || row.ReportDate || row.TradeDate || "";
        const symbol = (row.Symbol || "").toUpperCase();

        if (dividendInfo) {
          currency = dividendInfo.currency;
          const tradeMoneyBase = Math.abs(parseNumeric(row.TradeMoney));

          // If tax currency matches base currency, TradeMoney is already correct
          if (currency === baseCurrency) {
            amount = tradeMoneyBase;
          } else {
            // Tax is in a different currency than base (e.g., USD tax, GBP base)
            // Try to calculate using position × perShare × tax_rate
            const position = getPositionAtDate(positionHistory, symbol, txDate);

            if (position > 0 && dividendInfo.perShare > 0) {
              // Calculate gross dividend, then derive tax amount
              const grossDividend = position * dividendInfo.perShare;

              // Use the ratio of TradeMoney to estimated base currency dividend to get tax rate
              const fxRate = getFXRate(fxLookup, baseCurrency, currency, txDate);

              if (fxRate && fxRate > 0 && grossDividend > 0) {
                // Estimate what the base currency dividend would have been
                const estimatedBaseDividend = grossDividend / fxRate;
                // Calculate tax rate from ratio
                const taxRate = estimatedBaseDividend > 0 ? tradeMoneyBase / estimatedBaseDividend : 0;
                // Apply tax rate to actual dividend amount
                amount = grossDividend * taxRate;
              } else {
                // Fallback: use FX conversion on TradeMoney
                if (fxRate && fxRate > 0) {
                  amount = tradeMoneyBase * fxRate;
                } else {
                  amount = tradeMoneyBase;
                  console.warn(`No FX rate or position for ${baseCurrency}/${currency} tax: ${symbol} on ${txDate}, amount may be incorrect`);
                }
              }
            } else {
              // No position history - fallback to FX conversion
              const fxRate = getFXRate(fxLookup, baseCurrency, currency, txDate);
              if (fxRate && fxRate > 0) {
                amount = tradeMoneyBase * fxRate;
              } else {
                amount = tradeMoneyBase;
              }
            }
          }
        } else {
          amount = Math.abs(parseNumeric(row.TradeMoney));
        }
        fee = 0;
      } else {
        // For other transactions (deposits, withdrawals, fees, interest)
        // TradeMoney contains the cash amount

        // Special handling for TTAX (Transaction Tax) rows at BaseCurrency level
        // The TradeMoney contains the base currency equivalent, but we need the original currency amount
        // which is embedded in the description (e.g., "French Daily Trade Charge Tax HESAY 6")
        const activityCode = row.ActivityCode || "";
        if (activityCode === "TTAX") {
          const description = row.ActivityDescription || row.Description || "";
          const ttaxAmount = parseTTAXAmount(description);
          if (ttaxAmount !== null) {
            amount = ttaxAmount;
          } else {
            // Fallback to TradeMoney if parsing fails
            amount = Math.abs(parseNumeric(row.TradeMoney));
          }
        } else if (activityCode === "OFEE" && row.ListingExchange && EXCHANGE_TO_CURRENCY[row.ListingExchange]) {
          // OFEE dividend fees at BaseCurrency level need FX conversion
          // TradeMoney is in base currency, but the fee should be in the security's trading currency
          const targetCurrency = EXCHANGE_TO_CURRENCY[row.ListingExchange];
          const tradeMoneyBase = Math.abs(parseNumeric(row.TradeMoney));
          const txDate = row.Date || row.ReportDate || row.TradeDate || "";

          // Try to convert using FX rate
          const fxRate = getFXRate(fxLookup, baseCurrency, targetCurrency, txDate);
          if (fxRate && fxRate > 0) {
            amount = tradeMoneyBase * fxRate;
          } else {
            // Fallback: use TradeMoney as-is (in base currency - may be incorrect)
            amount = tradeMoneyBase;
            console.warn(`No FX rate for ${baseCurrency}/${targetCurrency} OFEE fee on ${txDate}, amount may be incorrect`);
          }
        } else {
          amount = Math.abs(parseNumeric(row.TradeMoney));
        }
        fee = Math.abs(parseNumeric(row.IBCommission));
      }

      const accountPreview = accountPreviews.find(p => p.currency === currency);

      if (!accountPreview) {
        console.warn(`No account found for currency ${currency}, skipping transaction for ${row.Symbol || row.ActivityDescription}`);
        continue;
      }

      // For cash transactions (not trades), quantity should be the cash amount
      // and unitPrice should be 1
      const isCashTransaction = ibkrType !== "IBKR_BUY" && ibkrType !== "IBKR_SELL";
      const finalQuantity = isCashTransaction ? amount : quantity;
      const finalUnitPrice = isCashTransaction ? 1 : unitPrice;

      const activity: ActivityImport = {
        accountId: "", // Will be set later when grouping by currency
        date: row.Date || row.ReportDate || new Date().toISOString().split("T")[0],
        symbol: row._resolvedTicker || row.Symbol || row.SecurityID || `$CASH-${currency}`,
        activityType: activityType as any,
        quantity: finalQuantity,
        unitPrice: finalUnitPrice,
        currency: currency,
        fee: fee,
        amount: amount,
        comment: row.ActivityDescription || row.Description || "",
        isDraft: false,
        isValid: true,
      };

      activities.push(activity);
    } catch (error) {
      console.error("Error converting activity:", error, row);
    }
  }

  return activities;
}

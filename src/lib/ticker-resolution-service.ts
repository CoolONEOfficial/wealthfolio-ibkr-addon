/**
 * Ticker Resolution Service
 *
 * Resolves IBKR symbols and ISINs to Yahoo Finance compatible tickers
 * Uses multiple strategies: ISIN lookup, symbol mapping, exchange suffix addition
 */

import { debug } from "./debug-logger";
import { isCashSymbol } from "./shared-utils";
import {
  resolveTicker,
  extractTickersToResolve,
  type TickerResolutionResult,
  type SearchTickerFn,
} from "./ticker-resolver";
import { TICKER_RESOLUTION_DELAY_MS } from "./constants";
import type { ProcessedIBKRRow } from "../types";

export interface TickerResolution {
  originalSymbol: string;
  resolvedTicker: string;
  isin?: string;
  confidence: "high" | "medium" | "low";
  source: "cache" | "api" | "mapping" | "fallback";
}

/**
 * Exchange to Yahoo Finance suffix mapping
 * Used for fallback when ISIN resolution fails
 */
const EXCHANGE_TO_SUFFIX: Record<string, string> = {
  // UK
  "LSE": ".L",
  "LSEIOB1": ".L",
  // Switzerland
  "EBS": ".SW",
  "SWX": ".SW",
  // Germany
  "FWB": ".DE",
  "IBIS": ".DE",
  "XETRA": ".DE",
  // France
  "SBF": ".PA",
  // Netherlands
  "AEB": ".AS",
  // Italy
  "BVME": ".MI",
  // Spain
  "BM": ".MC",
  // Hong Kong
  "SEHK": ".HK",
  // Japan
  "TSE": ".T",
  // Australia
  "ASX": ".AX",
  // Singapore
  "SGX": ".SI",
  // Norway
  "OSE": ".OL",
  // Sweden
  "SFB": ".ST",
  // Denmark
  "KFB": ".CO",
  // Canada
  "TSX": ".TO",
  "VENTURE": ".V",
  // US (no suffix needed)
  "NYSE": "",
  "NASDAQ": "",
  "AMEX": "",
  "ARCA": "",
  "BATS": "",
  "IEX": "",
};

/**
 * Format Hong Kong stock codes
 * HK stocks use numeric codes that need to be zero-padded to 4 digits
 */
function formatHKSymbol(symbol: string): string {
  // If symbol is purely numeric, pad with zeros and add .HK
  if (/^\d+$/.test(symbol)) {
    const paddedSymbol = symbol.padStart(4, "0");
    return `${paddedSymbol}.HK`;
  }
  return symbol;
}

/**
 * Add exchange suffix to symbol based on exchange
 */
function addExchangeSuffix(symbol: string, exchange: string): string {
  // Special handling for Hong Kong stocks (numeric symbols)
  if (exchange === "SEHK" || exchange === "HKSE") {
    return formatHKSymbol(symbol);
  }

  const suffix = EXCHANGE_TO_SUFFIX[exchange];
  if (suffix) {
    // Don't add suffix if symbol already has one
    if (symbol.includes(".")) {
      return symbol;
    }
    return `${symbol}${suffix}`;
  }

  return symbol;
}

/**
 * Resolve tickers from IBKR data
 * Uses full ticker resolution with ISIN lookup and fallback to exchange suffix mapping
 *
 * @param data - Array of parsed IBKR CSV data
 * @param onProgress - Progress callback
 * @param searchFn - Search function from addon context (ctx.api.marketData.searchTicker)
 */
export async function resolveTickersFromIBKR(
  data: ProcessedIBKRRow[],
  onProgress?: (current: number, total: number) => void,
  searchFn?: SearchTickerFn
): Promise<ProcessedIBKRRow[]> {
  const resolved = [...data];

  // Log search function availability (no longer using global state)
  if (searchFn) {
    debug.log("[Ticker Resolution] Search function provided - full resolution enabled");
  } else {
    debug.warn("[Ticker Resolution] No search function provided - resolution may be limited");
  }

  // Extract unique tickers that need resolution
  const tickersToResolve = extractTickersToResolve(data);
  const total = tickersToResolve.length;

  debug.log(`[Ticker Resolution] Found ${total} unique tickers to resolve`);

  // Create a map for fast lookup: isin:exchange -> resolved ticker
  const resolutionMap = new Map<string, TickerResolutionResult>();

  // Resolve each unique ticker
  for (let i = 0; i < tickersToResolve.length; i++) {
    const request = tickersToResolve[i];
    const key = `${request.isin}:${request.exchange}`;

    // Update progress
    if (onProgress) {
      onProgress(i + 1, total);
    }

    debug.log(
      `[Ticker Resolution] Resolving ${i + 1}/${total}: ${request.symbol} (ISIN: ${request.isin}, Exchange: ${request.exchange})`
    );

    try {
      // Pass searchFn directly to avoid global state race conditions
      let result = await resolveTicker(request, { searchFn });

      // If resolution failed or has low confidence, try adding exchange suffix
      if (
        result.confidence === "low" ||
        result.confidence === "failed" ||
        result.source === "fallback"
      ) {
        const suffixedSymbol = addExchangeSuffix(request.symbol, request.exchange);
        if (suffixedSymbol !== request.symbol) {
          debug.log(
            `[Ticker Resolution] Adding exchange suffix: ${request.symbol} -> ${suffixedSymbol}`
          );
          result = {
            ...result,
            yahooTicker: suffixedSymbol,
            confidence: "medium",
            source: "fallback",
          };
        }
      }

      resolutionMap.set(key, result);

      debug.log(
        `[Ticker Resolution] ${request.symbol} -> ${result.yahooTicker} (confidence: ${result.confidence})`
      );
    } catch (error) {
      debug.error(`[Ticker Resolution] Error resolving ${request.symbol}:`, error);
      // Use fallback with exchange suffix
      const suffixedSymbol = addExchangeSuffix(request.symbol, request.exchange);
      resolutionMap.set(key, {
        yahooTicker: suffixedSymbol,
        confidence: "low",
        source: "fallback",
      });
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, TICKER_RESOLUTION_DELAY_MS));
  }

  // Apply resolutions to all rows
  for (let i = 0; i < resolved.length; i++) {
    const row = resolved[i];

    // Skip cash transactions
    if (isCashSymbol(row.Symbol)) {
      resolved[i]._resolvedTicker = row.Symbol;
      resolved[i]._tickerConfidence = "high";
      continue;
    }

    const isin = row.ISIN?.toString().trim() || row.SecurityID?.toString().trim();
    const exchange = row.ListingExchange?.toString().trim() || row.Exchange?.toString().trim();

    if (isin && exchange) {
      const key = `${isin}:${exchange}`;
      const resolution = resolutionMap.get(key);

      if (resolution && resolution.yahooTicker) {
        resolved[i]._resolvedTicker = resolution.yahooTicker;
        resolved[i]._tickerConfidence = resolution.confidence;
        resolved[i]._tickerSource = resolution.source;
      } else {
        // Fallback: use symbol with exchange suffix
        const suffixedSymbol = addExchangeSuffix(row.Symbol || "", exchange);
        resolved[i]._resolvedTicker = suffixedSymbol;
        resolved[i]._tickerConfidence = "low";
        resolved[i]._tickerSource = "fallback";
      }
    } else if (row.Symbol) {
      // No ISIN/exchange info, try to add suffix based on currency
      const currency = row.CurrencyPrimary?.toString().trim();
      let symbol = row.Symbol;

      // Infer exchange from currency for suffix
      if (currency === "GBP" && !symbol.includes(".")) {
        symbol = `${symbol}.L`;
      } else if (currency === "CHF" && !symbol.includes(".")) {
        symbol = `${symbol}.SW`;
      } else if (currency === "EUR" && !symbol.includes(".")) {
        // Could be multiple exchanges, use .DE as default
        symbol = `${symbol}.DE`;
      } else if (currency === "AUD" && !symbol.includes(".")) {
        symbol = `${symbol}.AX`;
      } else if (currency === "HKD") {
        symbol = formatHKSymbol(symbol);
      } else if (currency === "NOK" && !symbol.includes(".")) {
        symbol = `${symbol}.OL`;
      } else if (currency === "SEK" && !symbol.includes(".")) {
        symbol = `${symbol}.ST`;
      } else if (currency === "CAD" && !symbol.includes(".")) {
        symbol = `${symbol}.TO`;
      } else if (currency === "JPY" && !symbol.includes(".")) {
        symbol = `${symbol}.T`;
      }

      resolved[i]._resolvedTicker = symbol;
      resolved[i]._tickerConfidence = "medium";
      resolved[i]._tickerSource = "currency-inferred";
    }
  }

  return resolved;
}


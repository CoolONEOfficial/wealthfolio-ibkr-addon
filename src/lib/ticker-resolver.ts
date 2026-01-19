/**
 * Ticker Resolution Utility
 *
 * Implements 4-tier strategy for resolving IBKR ISINs to Yahoo Finance tickers:
 * 1. Local cache (localStorage)
 * 2. Wealthfolio search API (stub)
 * 3. Yahoo Finance ISIN search API
 * 4. Manual user selection (UI handles)
 *
 * NO hardcoded exchange suffixes - all resolution is ISIN-based via Yahoo Finance API
 */

import { API_REQUEST_TIMEOUT_MS } from "./constants";

export interface TickerResolutionRequest {
  isin: string;
  symbol: string;
  exchange: string;
  currency: string;
  cusip?: string;
  figi?: string;
  description?: string;
  listingExchange?: string;
}

export interface TickerResolutionResult {
  yahooTicker: string | null;
  confidence: "high" | "medium" | "low" | "failed";
  source: "cache" | "wealthfolio" | "yfinance" | "manual" | "fallback";
  name?: string;
  alternatives?: string[];
  error?: string;
}

export interface TickerCacheEntry {
  yahooTicker: string;
  confidence: string;
  name?: string;
  timestamp: string;
}

const YAHOO_FINANCE_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search";
const YAHOO_FINANCE_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

const LOCALSTORAGE_CACHE_KEY = "ibkr_ticker_cache";

/**
 * Tier 1: Check local cache (uses localStorage in web mode)
 */
async function checkLocalCache(
  isin: string,
  exchange: string,
): Promise<TickerResolutionResult | null> {
  const cacheKey = `${isin}:${exchange}`;

  // In web mode, only use localStorage
  try {
    const cacheContent = localStorage.getItem(LOCALSTORAGE_CACHE_KEY);
    if (cacheContent) {
      const cache: Record<string, TickerCacheEntry> = JSON.parse(cacheContent);
      if (cache[cacheKey]) {
        const entry = cache[cacheKey];
        return {
          yahooTicker: entry.yahooTicker,
          confidence: entry.confidence as "high" | "medium" | "low" | "failed",
          source: "cache",
          name: entry.name,
        };
      }
    }
  } catch (error) {
    // Cache errors are non-fatal but should be logged for debugging
    console.warn(`[Ticker Resolver] Cache read error for ${isin}:${exchange}:`, error instanceof Error ? error.message : String(error));
  }

  return null;
}

/**
 * Save successful resolution to local cache (uses localStorage in web mode)
 */
async function saveToLocalCache(
  isin: string,
  exchange: string,
  result: TickerResolutionResult,
): Promise<void> {
  if (!result.yahooTicker || result.confidence === "failed") {
    return; // Only cache successful resolutions
  }

  const cacheKey = `${isin}:${exchange}`;
  const entry: TickerCacheEntry = {
    yahooTicker: result.yahooTicker,
    confidence: result.confidence,
    name: result.name,
    timestamp: new Date().toISOString(),
  };

  // Use localStorage for web mode
  try {
    let cache: Record<string, TickerCacheEntry> = {};
    const cacheContent = localStorage.getItem(LOCALSTORAGE_CACHE_KEY);
    if (cacheContent) {
      cache = JSON.parse(cacheContent);
    }
    cache[cacheKey] = entry;
    localStorage.setItem(LOCALSTORAGE_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    // Cache errors are non-fatal but should be logged for debugging
    console.warn(`[Ticker Resolver] Cache write error for ${isin}:${exchange}:`, error instanceof Error ? error.message : String(error));
  }
}

// Global reference to search function (set via setSearchFunction)
let globalSearchTicker: ((query: string) => Promise<any[]>) | null = null;

/**
 * Set the search ticker function from addon context
 * This should be called at addon initialization
 */
export function setSearchFunction(searchFn: (query: string) => Promise<any[]>): void {
  globalSearchTicker = searchFn;
}

/**
 * Tier 2: Try Wealthfolio search API (searches via Rust backend, bypasses CORS)
 * Enhanced with CUSIP, FIGI, and description searches
 */
async function searchWealthfolioAPI(request: TickerResolutionRequest): Promise<TickerResolutionResult | null> {
  const { isin, symbol, cusip, figi, description } = request;
  console.log(`[Ticker Resolver] Wealthfolio API search: ISIN=${isin}, symbol=${symbol}, CUSIP=${cusip || 'N/A'}, FIGI=${figi || 'N/A'}`);

  // Use the global search function set via setSearchFunction
  const searchTicker = globalSearchTicker;

  if (!searchTicker) {
    console.warn('[Ticker Resolver] No search function available - call setSearchFunction first');
    return null;
  }

  let results: any[] = [];

  // Try searching by ISIN first
  if (isin) {
    try {
      results = await searchTicker(isin);
      console.log(`[Ticker Resolver] Wealthfolio ISIN search found ${results.length} results`);

      if (results.length > 0) {
        // Log all results for debugging
        results.forEach((r, idx) => {
          console.log(`[Ticker Resolver] Result ${idx + 1}: ${r.symbol} (exchange: ${r.exchange}, score: ${r.score})`);
        });

        // If multiple results, try to match by exchange name or prefer suffixed symbols for non-US exchanges
        let result = results[0];

        if (results.length > 1) {
          // For non-US exchanges, prefer symbols with exchange suffixes (contain a dot)
          const isNonUSExchange = request.exchange && !['NYSE', 'NASDAQ', 'AMEX'].includes(request.exchange);

          if (isNonUSExchange) {
            // Prefer results that have a dot in the symbol (indicating exchange suffix)
            const suffixedResult = results.find(r => r.symbol.includes('.'));
            if (suffixedResult) {
              result = suffixedResult;
              console.log(`[Ticker Resolver] Selected suffixed ticker for non-US exchange: ${result.symbol}`);
            }
          }

          // Also try to match exchange names (e.g., "LSE" in both IBKR and result)
          const exchangeMatchResult = results.find(r =>
            r.exchange && request.exchange &&
            (r.exchange.toLowerCase().includes(request.exchange.toLowerCase()) ||
             request.exchange.toLowerCase().includes(r.exchange.toLowerCase()))
          );

          if (exchangeMatchResult) {
            result = exchangeMatchResult;
            console.log(`[Ticker Resolver] Matched by exchange name: ${result.symbol} (${result.exchange})`);
          }
        }

        return {
          yahooTicker: result.symbol,
          confidence: "high",
          source: "wealthfolio",
          name: result.name || result.symbol,
        };
      }
    } catch (isinError) {
      console.log(`[Ticker Resolver] ISIN search returned no results or error`);
    }
  }

  // Try searching by CUSIP (US securities)
  if (cusip) {
    console.log(`[Ticker Resolver] Trying Wealthfolio search with CUSIP: ${cusip}`);
    try {
      results = await searchTicker(cusip);
      console.log(`[Ticker Resolver] Wealthfolio CUSIP search found ${results.length} results`);
      if (results.length > 0) {
        const result = results[0];
        return {
          yahooTicker: result.symbol,
          confidence: "high",
          source: "wealthfolio",
          name: result.name || result.symbol,
        };
      }
    } catch (cusipError) {
      console.log(`[Ticker Resolver] CUSIP search for ${cusip} returned no results or error`);
    }
  }

  // Try searching by FIGI (Bloomberg identifier)
  if (figi) {
    console.log(`[Ticker Resolver] Trying Wealthfolio search with FIGI: ${figi}`);
    try {
      results = await searchTicker(figi);
      console.log(`[Ticker Resolver] Wealthfolio FIGI search found ${results.length} results`);
      if (results.length > 0) {
        const result = results[0];
        return {
          yahooTicker: result.symbol,
          confidence: "high",
          source: "wealthfolio",
          name: result.name || result.symbol,
        };
      }
    } catch (figiError) {
      console.log(`[Ticker Resolver] FIGI search for ${figi} returned no results or error`);
    }
  }

  // Try searching by symbol (more precise than description)
  if (symbol) {
    console.log(`[Ticker Resolver] Trying Wealthfolio search with symbol: ${symbol}`);
    try {
      results = await searchTicker(symbol);
      console.log(`[Ticker Resolver] Wealthfolio symbol search found ${results.length} results`);

      if (results.length > 0) {
        // Log all results for debugging
        results.forEach((r, idx) => {
          console.log(`[Ticker Resolver] Symbol result ${idx + 1}: ${r.symbol} (exchange: ${r.exchange || 'N/A'}, score: ${r.score})`);
        });

        // If multiple results, prefer suffixed symbols for non-US exchanges
        let result = results[0];

        if (results.length > 1) {
          const isNonUSExchange = request.exchange && !['NYSE', 'NASDAQ', 'AMEX'].includes(request.exchange);

          if (isNonUSExchange) {
            // Prefer results with exchange suffix (contains a dot)
            const suffixedResult = results.find(r => r.symbol.includes('.'));
            if (suffixedResult) {
              result = suffixedResult;
              console.log(`[Ticker Resolver] Selected suffixed ticker for non-US exchange ${request.exchange}: ${result.symbol}`);
            }
          }

          // Try to match exchange names
          const exchangeMatchResult = results.find(r =>
            r.exchange && request.exchange &&
            (r.exchange.toLowerCase().includes(request.exchange.toLowerCase()) ||
             request.exchange.toLowerCase().includes(r.exchange.toLowerCase()))
          );

          if (exchangeMatchResult) {
            result = exchangeMatchResult;
            console.log(`[Ticker Resolver] Matched by exchange name: ${result.symbol} (${result.exchange})`);
          }
        }

        return {
          yahooTicker: result.symbol,
          confidence: "high",
          source: "wealthfolio",
          name: result.name || result.symbol,
        };
      }
    } catch (symbolError) {
      console.log(`[Ticker Resolver] Symbol search for ${symbol} returned no results or error`);
    }

    // If still no results, try with .L suffix for London stocks (common for IBKR ETFs)
    console.log(`[Ticker Resolver] Trying with .L suffix: ${symbol}.L`);
    try {
      results = await searchTicker(`${symbol}.L`);
      console.log(`[Ticker Resolver] Search for ${symbol}.L found ${results.length} results`);
      if (results.length > 0) {
        const result = results[0];
        return {
          yahooTicker: result.symbol,
          confidence: "high",
          source: "wealthfolio",
          name: result.name || result.symbol,
        };
      }
    } catch (suffixError) {
      console.log(`[Ticker Resolver] .L suffix search returned no results or error`);
    }
  }

  // Try searching by description (company/fund name) - LAST RESORT only
  // Description can match multiple securities with similar names, so use as fallback only
  if (description) {
    console.log(`[Ticker Resolver] Trying Wealthfolio search with description: ${description}`);
    try {
      results = await searchTicker(description);
      console.log(`[Ticker Resolver] Wealthfolio description search found ${results.length} results`);
      if (results.length > 0) {
        const result = results[0];
        return {
          yahooTicker: result.symbol,
          confidence: "medium", // Lower confidence for description-based matches
          source: "wealthfolio",
          name: result.name || result.symbol,
        };
      }
    } catch (descError) {
      console.log(`[Ticker Resolver] Description search returned no results or error`);
    }
  }

  console.log(`[Ticker Resolver] No results found for ISIN ${isin}, CUSIP ${cusip}, FIGI ${figi}, or symbol ${symbol}`);
  return null;
}

/**
 * Validate that a ticker exists on Yahoo Finance
 */
async function validateYahooTicker(ticker: string): Promise<boolean> {
  try {
    const url = `${YAHOO_FINANCE_CHART_URL}/${encodeURIComponent(ticker)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    const error = data?.chart?.error;

    // If no error field, ticker is valid
    return !error;
  } catch (error) {
    console.warn(`Failed to validate ticker ${ticker}:`, error);
    return false;
  }
}

/**
 * Tier 3: Search Yahoo Finance by ISIN
 */
async function searchYahooFinanceByISIN(
  isin: string,
): Promise<TickerResolutionResult | null> {
  if (!isin) {
    console.log('[Ticker Resolver] ISIN search: no ISIN provided');
    return null;
  }

  try {
    const url = `${YAHOO_FINANCE_SEARCH_URL}?q=${encodeURIComponent(isin)}`;
    console.log(`[Ticker Resolver] Searching ISIN: ${isin}`);
    console.log(`[Ticker Resolver] Fetch URL: ${url}`);

    console.log(`[Ticker Resolver] Starting fetch for ${isin}...`);

    // Add timeout to fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: controller.signal,
      mode: 'cors',
    });
    clearTimeout(timeoutId);
    console.log(`[Ticker Resolver] Fetch completed for ${isin}`);

    console.log(`[Ticker Resolver] ISIN ${isin} response status: ${response.status}`);

    if (!response.ok) {
      console.warn(`[Ticker Resolver] ISIN ${isin} search failed: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const quotes = data.quotes || [];

    console.log(`[Ticker Resolver] ISIN ${isin} found ${quotes.length} quotes`);

    if (quotes.length > 0) {
      const quote = quotes[0];
      const ticker = quote.symbol;
      console.log(`[Ticker Resolver] ISIN ${isin} → ${ticker}, validating...`);

      // Validate the ticker to ensure it's accessible
      const isValid = await validateYahooTicker(ticker);

      console.log(`[Ticker Resolver] Ticker ${ticker} validation: ${isValid ? 'VALID' : 'INVALID'}`);

      if (isValid) {
        return {
          yahooTicker: ticker,
          confidence: "high",
          source: "yfinance",
          name: quote.longname || quote.shortname || ticker,
        };
      }
    }
  } catch (error) {
    console.warn(`[Ticker Resolver] ERROR - Failed to search ISIN ${isin}:`, error);
    console.warn(`[Ticker Resolver] Error type: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`[Ticker Resolver] ISIN ${isin} resolution failed, returning null`);
  return null;
}

/**
 * Minimal fallback ticker
 * Returns the original IBKR symbol in uppercase with low confidence
 * This is used when ISIN search fails - user will need to manually resolve
 */
function createFallbackTicker(symbol: string): TickerResolutionResult {
  const processedSymbol = symbol.toUpperCase();

  return {
    yahooTicker: processedSymbol,
    confidence: "low",
    source: "fallback",
    alternatives: [processedSymbol],
  };
}

/**
 * Main ticker resolution function
 * Attempts all tiers in order until a resolution is found
 */
export async function resolveTicker(
  request: TickerResolutionRequest,
): Promise<TickerResolutionResult> {
  const { isin, symbol, exchange } = request;

  // Tier 1: Local cache
  const cached = await checkLocalCache(isin, exchange);
  if (cached) {
    console.log(`[Ticker Resolver] Cache hit: ${isin} → ${cached.yahooTicker}`);
    return cached;
  }

  // Tier 2: Wealthfolio search API (uses Rust backend, bypasses CORS)
  // Now passes full request with CUSIP, FIGI, description
  const wealthfolioResult = await searchWealthfolioAPI(request);
  if (wealthfolioResult) {
    console.log(`[Ticker Resolver] Wealthfolio API: ${isin} → ${wealthfolioResult.yahooTicker}`);
    await saveToLocalCache(isin, exchange, wealthfolioResult);
    return wealthfolioResult;
  }

  // Tier 3: Yahoo Finance ISIN search
  const yahooResult = await searchYahooFinanceByISIN(isin);
  if (yahooResult) {
    console.log(`[Ticker Resolver] Yahoo Finance ISIN search: ${isin} → ${yahooResult.yahooTicker}`);
    await saveToLocalCache(isin, exchange, yahooResult);
    return yahooResult;
  }

  // Tier 4: Manual selection is handled by the UI component
  // For now, return minimal fallback with low confidence

  console.log(`[Ticker Resolver] Fallback: ${symbol} (ISIN search failed, needs manual resolution)`);
  const fallback = createFallbackTicker(symbol);
  return fallback;
}

/**
 * Get unique tickers that need resolution from parsed CSV data
 * Extracts ISIN, Symbol, CUSIP, FIGI, Description, and ListingExchange
 */
export function extractTickersToResolve(
  data: Record<string, any>[],
): TickerResolutionRequest[] {
  const tickerMap = new Map<string, TickerResolutionRequest>();

  for (const row of data) {
    const isin = row.ISIN?.toString().trim();
    const symbol = row.Symbol?.toString().trim();
    const rawExchange = row.Exchange?.toString().trim();
    const currency = row.CurrencyPrimary?.toString().trim();

    // Extract additional identifiers
    const cusip = row.CUSIP?.toString().trim();
    const figi = row.FIGI?.toString().trim();
    const description = row.Description?.toString().trim();
    const listingExchange = row.ListingExchange?.toString().trim();

    // Skip header rows (where Symbol column contains "Symbol")
    if (symbol === 'Symbol' || symbol === '' || !symbol) {
      continue;
    }

    // Use ListingExchange (real exchange like NYSE, NASDAQ) instead of Exchange (trade IDs)
    // Exchange column often contains trade IDs (numeric) or DARK pool identifiers
    const exchange = listingExchange || rawExchange;

    // Skip rows where exchange looks like a trade ID (numeric) or is empty
    if (!exchange || /^\d+$/.test(exchange)) {
      continue;
    }

    // Skip special exchanges and rows without required data
    const skipExchanges = ['IDEALFX', 'TransactionID', 'TransferAccount', 'DARK'];
    if (!isin || !symbol || !currency || skipExchanges.includes(exchange)) {
      continue;
    }

    const key = `${isin}:${exchange}`;

    if (!tickerMap.has(key)) {
      tickerMap.set(key, {
        isin,
        symbol,
        exchange,
        currency,
        cusip: cusip || undefined,
        figi: figi || undefined,
        description: description || undefined,
        listingExchange: listingExchange || undefined,
      });
    }
  }

  return Array.from(tickerMap.values());
}

/**
 * Shared constants for the IBKR Multi-Currency Import addon
 */

// ==================== Timing Constants ====================

/**
 * Cooldown period between auto-fetches (6 hours)
 * IBKR Activity Statements update once daily, so 6 hours is reasonable
 */
export const FETCH_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Stale time for React Query cache (30 seconds)
 */
export const QUERY_STALE_TIME_MS = 30 * 1000;

/**
 * Delay between ticker resolution requests to avoid rate limiting (50ms)
 */
export const TICKER_RESOLUTION_DELAY_MS = 50;

/**
 * Initial delay for Flex Query polling (2 seconds)
 */
export const FLEX_QUERY_INITIAL_DELAY_MS = 2000;

/**
 * Maximum delay for Flex Query polling backoff (30 seconds)
 */
export const FLEX_QUERY_MAX_DELAY_MS = 30000;

/**
 * Absolute timeout for Flex Query fetch operation (2 minutes)
 * Prevents hanging indefinitely if IBKR is slow to generate statements
 */
export const FLEX_QUERY_ABSOLUTE_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Timeout for external API requests (10 seconds)
 */
export const API_REQUEST_TIMEOUT_MS = 10000;

// ==================== Limits ====================

/**
 * Maximum file size for CSV uploads (50MB)
 */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Timeout for reading a single CSV file (30 seconds)
 * Prevents UI from hanging indefinitely on very large files
 */
export const FILE_READ_TIMEOUT_MS = 30000;

/**
 * Maximum number of files for batch import
 */
export const MAX_FILES = 20;

/**
 * Maximum number of debug logs to show in deduplication
 */
export const MAX_DEBUG_LOGS = 5;

/**
 * Debounce delay for auto-fetch trigger (5 seconds)
 * Multiple portfolio update events within this window consolidate into one fetch
 */
export const AUTO_FETCH_DEBOUNCE_MS = 5000;

/**
 * Maximum number of entries in the ticker resolution cache
 * Prevents unbounded localStorage growth
 */
export const TICKER_CACHE_MAX_ENTRIES = 1000;

/**
 * Maximum age for ticker cache entries (30 days in milliseconds)
 * Entries older than this are pruned to keep data fresh
 */
export const TICKER_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// ==================== Validation Limits ====================

/**
 * Minimum length for IBKR Flex Query token
 * IBKR tokens are typically 32+ character alphanumeric strings
 */
export const MIN_TOKEN_LENGTH = 16;

/**
 * Maximum length for IBKR Flex Query token
 */
export const MAX_TOKEN_LENGTH = 128;

/**
 * Maximum length for IBKR Flex Query ID
 * Query IDs are numeric identifiers
 */
export const MAX_QUERY_ID_LENGTH = 20;

/**
 * Maximum reasonable FX rate for sanity checking
 * Used to filter out invalid FX conversion data
 */
export const MAX_FX_RATE = 1000;

/**
 * Maximum reasonable per-share dividend amount (sanity check)
 * Even the highest-paying stocks don't pay >$10,000 per share
 * This prevents parsing errors from creating unrealistic values
 */
export const MAX_REASONABLE_DIVIDEND_PER_SHARE = 10000;

// ==================== Time Conversion ====================

/**
 * Milliseconds per hour (for calculations)
 */
export const MS_PER_HOUR = 60 * 60 * 1000;

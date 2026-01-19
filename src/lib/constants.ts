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
 * Timeout for external API requests (10 seconds)
 */
export const API_REQUEST_TIMEOUT_MS = 10000;

// ==================== Limits ====================

/**
 * Maximum file size for CSV uploads (50MB)
 */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Maximum number of files for batch import
 */
export const MAX_FILES = 20;

/**
 * Maximum number of debug logs to show in deduplication
 */
export const MAX_DEBUG_LOGS = 5;

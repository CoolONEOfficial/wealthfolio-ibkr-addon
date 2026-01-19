/**
 * IBKR Flex Query Web Service API Client
 *
 * Two-step HTTP API for programmatically retrieving pre-configured Flex Queries:
 * 1. Send request to generate report (returns reference code)
 * 2. Retrieve generated report using reference code
 *
 * API Documentation:
 * - Base URL: https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService
 * - SendRequest endpoint: /SendRequest?t={TOKEN}&q={QUERY_ID}&v=3
 * - GetStatement endpoint: /GetStatement?t={TOKEN}&q={REFERENCE_CODE}&v=3
 */

import { FLEX_QUERY_INITIAL_DELAY_MS, FLEX_QUERY_MAX_DELAY_MS, FLEX_QUERY_ABSOLUTE_TIMEOUT_MS } from "./constants";

export interface FlexQueryConfig {
  token: string;
  queryId: string;
}

/**
 * Validate IBKR Flex Query token format
 * IBKR tokens are typically 32+ character alphanumeric strings
 */
export function validateFlexToken(token: string): { valid: boolean; error?: string } {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Token is required" };
  }
  const trimmed = token.trim();
  if (trimmed.length < 16) {
    return { valid: false, error: "Token appears too short (minimum 16 characters)" };
  }
  if (trimmed.length > 128) {
    return { valid: false, error: "Token appears too long (maximum 128 characters)" };
  }
  // IBKR tokens are alphanumeric
  if (!/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return { valid: false, error: "Token should contain only alphanumeric characters" };
  }
  return { valid: true };
}

/**
 * Validate IBKR Flex Query ID format
 * Query IDs are numeric identifiers
 */
export function validateQueryId(queryId: string): { valid: boolean; error?: string } {
  if (!queryId || typeof queryId !== "string") {
    return { valid: false, error: "Query ID is required" };
  }
  const trimmed = queryId.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, error: "Query ID should be numeric" };
  }
  if (trimmed.length > 20) {
    return { valid: false, error: "Query ID appears too long" };
  }
  return { valid: true };
}

export interface FlexQueryRequestResult {
  success: boolean;
  referenceCode?: string;
  url?: string;
  error?: string;
  errorCode?: number;
}

export interface FlexQueryStatementResult {
  success: boolean;
  csv?: string;
  error?: string;
  errorCode?: number;
}

export interface FlexQueryResult {
  success: boolean;
  csv?: string;
  error?: string;
  errorCode?: number;
}

/**
 * HTTP client interface for making requests
 * Uses addon SDK's HTTP API to bypass CORS
 */
export interface HttpClient {
  fetch(
    url: string,
    options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeout_ms?: number;
    }
  ): Promise<{
    status: number;
    status_text: string;
    headers: Record<string, string>;
    body: string;
    ok: boolean;
  }>;
}

/**
 * IBKR Flex API error codes
 */
export const FLEX_ERROR_CODES: Record<number, string> = {
  1001: "Statement generation unavailable; retry shortly",
  1003: "Statement generation in progress; wait and try again",
  1004: "Statement ready for download",
  1005: "Statement failed to generate; try again",
  1006: "Statement is too large; try with a smaller date range",
  1007: "Statement request invalid",
  1010: "Server error; retry later",
  1011: "Statement ID not found",
  1012: "Token has expired",
  1013: "IP address restriction violated",
  1014: "Query is invalid",
  1015: "Token is invalid",
  1016: "Token missing permissions",
  1017: "Statement date range invalid",
  1018: "Rate limit exceeded",
  1019: "Statement pending generation",
};

const FLEX_API_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";
const USER_AGENT = "Wealthfolio/1.0";

// Module-level HTTP client - set via setHttpClient()
let httpClient: HttpClient | null = null;

/**
 * Set the HTTP client to use for API requests
 * This should be called with ctx.api.http from the addon context
 */
export function setHttpClient(client: HttpClient): void {
  httpClient = client;
}

/**
 * Get the current HTTP client
 */
function getHttpClient(): HttpClient {
  if (!httpClient) {
    throw new Error(
      "HTTP client not set. Call setHttpClient(ctx.api.http) before using Flex Query functions."
    );
  }
  return httpClient;
}

/**
 * Parse XML response to extract status and data
 */
function parseFlexResponse(xml: string): {
  status: string;
  referenceCode?: string;
  url?: string;
  errorCode?: number;
  errorMessage?: string;
} {
  // Extract status
  const statusMatch = /<Status>([^<]+)<\/Status>/i.exec(xml);
  const status = statusMatch ? statusMatch[1] : "";

  // Extract reference code
  const refMatch = /<ReferenceCode>([^<]+)<\/ReferenceCode>/i.exec(xml);
  const referenceCode = refMatch ? refMatch[1] : undefined;

  // Extract URL
  const urlMatch = /<Url>([^<]+)<\/Url>/i.exec(xml);
  const url = urlMatch ? urlMatch[1] : undefined;

  // Extract error code
  const errorCodeMatch = /<ErrorCode>(\d+)<\/ErrorCode>/i.exec(xml);
  const errorCode = errorCodeMatch ? parseInt(errorCodeMatch[1], 10) : undefined;

  // Extract error message
  const errorMsgMatch = /<ErrorMessage>([^<]+)<\/ErrorMessage>/i.exec(xml);
  const errorMessage = errorMsgMatch ? errorMsgMatch[1] : undefined;

  return { status, referenceCode, url, errorCode, errorMessage };
}

/**
 * Step 1: Send request to generate Flex Query report
 *
 * @param config Flex Query configuration with token and query ID
 * @returns Promise resolving to request result with reference code or error
 */
export async function sendFlexRequest(
  config: FlexQueryConfig
): Promise<FlexQueryRequestResult> {
  const url = `${FLEX_API_BASE}/SendRequest?t=${encodeURIComponent(config.token)}&q=${encodeURIComponent(config.queryId)}&v=3`;

  try {
    const client = getHttpClient();
    const response = await client.fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP error: ${response.status} ${response.status_text}`,
      };
    }

    const xml = response.body;
    const parsed = parseFlexResponse(xml);

    if (parsed.status === "Success" && parsed.referenceCode) {
      return {
        success: true,
        referenceCode: parsed.referenceCode,
        url: parsed.url,
      };
    }

    // Handle error response
    const errorMessage =
      parsed.errorMessage ||
      (parsed.errorCode && FLEX_ERROR_CODES[parsed.errorCode]) ||
      "Unknown error from IBKR";

    return {
      success: false,
      error: errorMessage,
      errorCode: parsed.errorCode,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Network error: ${message}`,
    };
  }
}

/**
 * Step 2: Retrieve generated Flex Query statement
 *
 * @param config Flex Query configuration with token
 * @param referenceCode Reference code from sendFlexRequest
 * @returns Promise resolving to statement XML or error
 */
export async function getFlexStatement(
  config: FlexQueryConfig,
  referenceCode: string
): Promise<FlexQueryStatementResult> {
  const url = `${FLEX_API_BASE}/GetStatement?t=${encodeURIComponent(config.token)}&q=${encodeURIComponent(referenceCode)}&v=3`;

  try {
    const client = getHttpClient();
    const response = await client.fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP error: ${response.status} ${response.status_text}`,
      };
    }

    const responseBody = response.body;

    // Check if response is an error (has Status element - XML error response)
    if (responseBody.includes("<Status>") && !responseBody.includes("<FlexQueryResponse>")) {
      const parsed = parseFlexResponse(responseBody);

      // Special handling for "statement in progress"
      if (parsed.errorCode === 1003 || parsed.errorCode === 1019) {
        return {
          success: false,
          error: "Statement generation in progress",
          errorCode: parsed.errorCode,
        };
      }

      const errorMessage =
        parsed.errorMessage ||
        (parsed.errorCode && FLEX_ERROR_CODES[parsed.errorCode]) ||
        "Unknown error from IBKR";

      return {
        success: false,
        error: errorMessage,
        errorCode: parsed.errorCode,
      };
    }

    // Success - return the CSV data
    return {
      success: true,
      csv: responseBody,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Network error: ${message}`,
    };
  }
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch Flex Query with automatic retry and polling
 *
 * This function:
 * 1. Sends request to generate report
 * 2. Polls for statement availability (with exponential backoff)
 * 3. Returns the statement XML or error
 *
 * Has both retry-based and absolute timeout protection to prevent hanging.
 *
 * @param config Flex Query configuration
 * @param options Polling options
 * @returns Promise resolving to Flex Query result
 */
export async function fetchFlexQuery(
  config: FlexQueryConfig,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    absoluteTimeoutMs?: number;
    onProgress?: (message: string) => void;
  } = {}
): Promise<FlexQueryResult> {
  const {
    maxRetries = 10,
    initialDelayMs = FLEX_QUERY_INITIAL_DELAY_MS,
    maxDelayMs = FLEX_QUERY_MAX_DELAY_MS,
    absoluteTimeoutMs = FLEX_QUERY_ABSOLUTE_TIMEOUT_MS,
    onProgress,
  } = options;

  const startTime = Date.now();

  // Step 1: Send request
  onProgress?.("Sending Flex Query request...");
  const requestResult = await sendFlexRequest(config);

  if (!requestResult.success || !requestResult.referenceCode) {
    return {
      success: false,
      error: requestResult.error || "Failed to get reference code",
      errorCode: requestResult.errorCode,
    };
  }

  onProgress?.(`Request accepted. Reference: ${requestResult.referenceCode}`);

  // Step 2: Poll for statement with both retry limit and absolute timeout
  let currentDelay = initialDelayMs;
  let retries = 0;

  while (retries < maxRetries) {
    // Check absolute timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= absoluteTimeoutMs) {
      onProgress?.("Operation timed out");
      return {
        success: false,
        error: `Absolute timeout exceeded (${Math.round(absoluteTimeoutMs / 1000)}s). IBKR may be experiencing delays.`,
      };
    }

    const remainingTime = absoluteTimeoutMs - elapsed;
    onProgress?.(`Waiting for statement (attempt ${retries + 1}/${maxRetries}, ${Math.round(remainingTime / 1000)}s remaining)...`);
    await delay(currentDelay);

    const statementResult = await getFlexStatement(config, requestResult.referenceCode);

    if (statementResult.success && statementResult.csv) {
      onProgress?.("Statement retrieved successfully");
      return {
        success: true,
        csv: statementResult.csv,
      };
    }

    // Check if we should retry (1003/1019 = generation in progress, 1018 = rate limit)
    if (
      statementResult.errorCode === 1003 ||
      statementResult.errorCode === 1019 ||
      statementResult.errorCode === 1018 ||
      statementResult.error === "Statement generation in progress"
    ) {
      // Statement still generating or rate limited, continue polling with backoff
      retries++;
      currentDelay = Math.min(currentDelay * 1.5, maxDelayMs);
      continue;
    }

    // Non-retryable error
    return {
      success: false,
      error: statementResult.error,
      errorCode: statementResult.errorCode,
    };
  }

  return {
    success: false,
    error: "Max retries exceeded waiting for statement generation",
  };
}

/**
 * Test connection to IBKR Flex Web Service
 *
 * Attempts to send a request (but doesn't wait for statement)
 * to verify credentials are valid.
 *
 * @param config Flex Query configuration
 * @returns Promise resolving to connection test result
 */
export async function testFlexConnection(
  config: FlexQueryConfig
): Promise<{ success: boolean; message: string }> {
  const result = await sendFlexRequest(config);

  if (result.success) {
    return {
      success: true,
      message: "Connection successful. Credentials are valid.",
    };
  }

  // Provide user-friendly error messages
  if (result.errorCode === 1015) {
    return {
      success: false,
      message: "Invalid token. Please check your Flex token.",
    };
  }

  if (result.errorCode === 1012) {
    return {
      success: false,
      message: "Token has expired. Please generate a new token in IBKR Client Portal.",
    };
  }

  if (result.errorCode === 1014) {
    return {
      success: false,
      message: "Invalid Query ID. Please check your Flex Query ID.",
    };
  }

  if (result.errorCode === 1013) {
    return {
      success: false,
      message: "IP address not allowed. Please update IP restrictions in IBKR Client Portal.",
    };
  }

  return {
    success: false,
    message: result.error || "Connection failed",
  };
}

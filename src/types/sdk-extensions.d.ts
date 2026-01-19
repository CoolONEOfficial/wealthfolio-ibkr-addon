/**
 * Type extensions for the Wealthfolio Addon SDK
 *
 * These declarations extend the SDK types to include properties that exist
 * at runtime but are not yet included in the official type definitions.
 */

import "@wealthfolio/addon-sdk";
import type { HttpClient } from "../lib/flex-query-fetcher";

declare module "@wealthfolio/addon-sdk" {
  /**
   * Extended HostAPI interface with http client
   */
  interface HostAPI {
    /**
     * HTTP client for making external API requests (e.g., to IBKR Flex Query API)
     * This property exists at runtime but is not in the base SDK types.
     * Uses the HttpClient interface defined in flex-query-fetcher.ts
     */
    http?: HttpClient;
  }
}

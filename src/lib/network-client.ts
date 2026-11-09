/**
 * Network Client
 *
 * Since Wealthfolio 3.6 addons run in a sandboxed iframe (opaque origin, CSP),
 * so direct `fetch()` calls are blocked. All external HTTP traffic must go
 * through the host network broker (`ctx.api.network.request`), which only
 * reaches hosts declared in `manifest.network.allowedHosts`.
 *
 * This module holds the broker reference (set once in `enable()`) and offers a
 * small request helper used by the Flex Query fetcher and the ticker resolver.
 */

import type { NetworkAPI } from "@wealthfolio/addon-sdk";

/** Subset of the SDK network API this addon depends on */
export type NetworkClient = Pick<NetworkAPI, "request">;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export interface HttpRequestOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  /** Request timeout in milliseconds (converted to whole seconds for the broker) */
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** True for 2xx status codes */
  ok: boolean;
}

/** The host caps brokered request timeouts at 120 seconds */
export const MAX_BROKER_TIMEOUT_SECS = 120;

let networkClient: NetworkClient | null = null;

/**
 * Register the host network broker. Call with `ctx.api.network` in `enable()`.
 * Passing null/undefined clears the client (used on disable and in tests).
 */
export function setNetworkClient(client: NetworkClient | null | undefined): void {
  networkClient = client ?? null;
}

/**
 * Whether a network client has been registered
 */
export function hasNetworkClient(): boolean {
  return networkClient !== null;
}

/**
 * Convert a millisecond timeout to the broker's whole-second timeout (1..120)
 */
export function toBrokerTimeoutSecs(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return undefined;
  }
  return Math.min(MAX_BROKER_TIMEOUT_SECS, Math.max(1, Math.ceil(timeoutMs / 1000)));
}

/**
 * Send an HTTP request through the host network broker
 *
 * @throws Error if no network client is registered or the broker rejects the request
 */
export async function httpRequest(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse> {
  if (!networkClient) {
    throw new Error(
      "Network client not set. Call setNetworkClient(ctx.api.network) in the addon's enable()."
    );
  }

  const response = await networkClient.request({
    url,
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    timeoutSecs: toBrokerTimeoutSecs(options.timeoutMs),
  });

  return {
    status: response.status,
    headers: response.headers ?? {},
    body: response.body ?? "",
    ok: response.status >= 200 && response.status < 300,
  };
}

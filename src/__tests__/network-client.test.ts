/**
 * Network Client Tests
 *
 * The addon sandbox blocks direct fetch(); all requests go through the
 * host network broker (ctx.api.network.request).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MAX_BROKER_TIMEOUT_SECS,
  hasNetworkClient,
  httpRequest,
  setNetworkClient,
  toBrokerTimeoutSecs,
} from "../lib/network-client";

afterEach(() => {
  setNetworkClient(null);
});

describe("toBrokerTimeoutSecs", () => {
  it("returns undefined when no timeout is given", () => {
    expect(toBrokerTimeoutSecs(undefined)).toBeUndefined();
  });

  it("returns undefined for non-positive or invalid values", () => {
    expect(toBrokerTimeoutSecs(0)).toBeUndefined();
    expect(toBrokerTimeoutSecs(-5)).toBeUndefined();
    expect(toBrokerTimeoutSecs(Number.NaN)).toBeUndefined();
  });

  it("rounds up to whole seconds with a minimum of 1", () => {
    expect(toBrokerTimeoutSecs(1)).toBe(1);
    expect(toBrokerTimeoutSecs(10000)).toBe(10);
    expect(toBrokerTimeoutSecs(10001)).toBe(11);
  });

  it("caps the timeout at the host maximum", () => {
    expect(toBrokerTimeoutSecs(10 * 60 * 1000)).toBe(MAX_BROKER_TIMEOUT_SECS);
  });
});

describe("httpRequest", () => {
  it("throws a descriptive error when no client is registered", async () => {
    expect(hasNetworkClient()).toBe(false);
    await expect(httpRequest("https://example.com")).rejects.toThrow("Network client not set");
  });

  it("forwards the request to the broker with defaults", async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, headers: {}, body: "ok" });
    setNetworkClient({ request });

    await httpRequest("https://ndcdyn.interactivebrokers.com/test");

    expect(request).toHaveBeenCalledWith({
      url: "https://ndcdyn.interactivebrokers.com/test",
      method: "GET",
      headers: undefined,
      body: undefined,
      timeoutSecs: undefined,
    });
  });

  it("maps method, headers, body and timeout", async () => {
    const request = vi.fn().mockResolvedValue({ status: 201, headers: {}, body: "" });
    setNetworkClient({ request });

    await httpRequest("https://example.com", {
      method: "POST",
      headers: { "User-Agent": "test" },
      body: "payload",
      timeoutMs: 60000,
    });

    expect(request).toHaveBeenCalledWith({
      url: "https://example.com",
      method: "POST",
      headers: { "User-Agent": "test" },
      body: "payload",
      timeoutSecs: 60,
    });
  });

  it.each([
    [200, true],
    [204, true],
    [299, true],
    [301, false],
    [404, false],
    [500, false],
  ])("derives ok from status %i -> %s", async (status, ok) => {
    setNetworkClient({ request: vi.fn().mockResolvedValue({ status, headers: {}, body: "" }) });
    const response = await httpRequest("https://example.com");
    expect(response.ok).toBe(ok);
    expect(response.status).toBe(status);
  });

  it("normalizes missing headers and body from the broker", async () => {
    setNetworkClient({ request: vi.fn().mockResolvedValue({ status: 204 }) });
    const response = await httpRequest("https://example.com");
    expect(response.headers).toEqual({});
    expect(response.body).toBe("");
  });

  it("propagates broker errors", async () => {
    setNetworkClient({ request: vi.fn().mockRejectedValue(new Error("host not allowed")) });
    await expect(httpRequest("https://example.com")).rejects.toThrow("host not allowed");
  });

  it("can be cleared again", () => {
    setNetworkClient({ request: vi.fn() });
    expect(hasNetworkClient()).toBe(true);
    setNetworkClient(undefined);
    expect(hasNetworkClient()).toBe(false);
  });
});

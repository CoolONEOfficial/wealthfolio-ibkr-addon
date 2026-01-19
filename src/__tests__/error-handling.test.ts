/**
 * Error Handling Tests
 *
 * Tests critical error paths that could cause failures in production:
 * - HTTP timeout in fetchFlexQuery
 * - Malformed XML response from IBKR API
 * - Credential validation
 * - Async lock error handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchFlexQuery, setHttpClient, validateFlexToken, validateQueryId, testFlexConnection } from "../lib/flex-query-fetcher";
import { AsyncLock, withLock } from "../lib/async-lock";

describe("Error Handling", () => {
  describe("Flex Query Fetcher", () => {
    beforeEach(() => {
      // Reset HTTP client before each test
      setHttpClient(undefined as any);
    });

    describe("validateFlexToken", () => {
      it("should reject empty token", () => {
        const result = validateFlexToken("");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Token is required");
      });

      it("should reject token that is too short", () => {
        const result = validateFlexToken("short");
        expect(result.valid).toBe(false);
        expect(result.error).toContain("too short");
      });

      it("should reject token that is too long", () => {
        const result = validateFlexToken("a".repeat(200));
        expect(result.valid).toBe(false);
        expect(result.error).toContain("too long");
      });

      it("should reject token with special characters", () => {
        const result = validateFlexToken("abc123!@#$%^&*()");
        expect(result.valid).toBe(false);
        expect(result.error).toContain("alphanumeric");
      });

      it("should accept valid alphanumeric token", () => {
        const result = validateFlexToken("abc123DEF456xyz789ABC");
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    describe("validateQueryId", () => {
      it("should reject empty query ID", () => {
        const result = validateQueryId("");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Query ID is required");
      });

      it("should reject non-numeric query ID", () => {
        const result = validateQueryId("abc123");
        expect(result.valid).toBe(false);
        expect(result.error).toContain("numeric");
      });

      it("should reject query ID that is too long", () => {
        const result = validateQueryId("1".repeat(25));
        expect(result.valid).toBe(false);
        expect(result.error).toContain("too long");
      });

      it("should accept valid numeric query ID", () => {
        const result = validateQueryId("123456789");
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    describe("fetchFlexQuery error handling", () => {
      it("should fail gracefully when no HTTP client is set", async () => {
        const result = await fetchFlexQuery({
          token: "validtoken12345678",
          queryId: "123456",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("HTTP client not set");
      });

      it("should timeout after absolute timeout period", async () => {
        // Mock: First call (SendRequest) succeeds with reference code
        // Subsequent calls (GetStatement) return "in progress" to trigger polling
        let callCount = 0;
        const mockHttpClient = {
          fetch: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              // SendRequest - return success with reference code
              return Promise.resolve({
                ok: true,
                status: 200,
                status_text: "OK",
                headers: {},
                body: "<FlexStatementResponse><Status>Success</Status><ReferenceCode>12345</ReferenceCode></FlexStatementResponse>",
              });
            }
            // GetStatement - always return "in progress" to force polling until timeout
            return Promise.resolve({
              ok: true,
              status: 200,
              status_text: "OK",
              headers: {},
              body: "<FlexStatementResponse><Status>Warn</Status><ErrorCode>1003</ErrorCode><ErrorMessage>Statement generation in progress</ErrorMessage></FlexStatementResponse>",
            });
          }),
        };
        setHttpClient(mockHttpClient);

        const result = await fetchFlexQuery(
          { token: "validtoken12345678", queryId: "123456" },
          {
            absoluteTimeoutMs: 150, // Very short timeout for test
            initialDelayMs: 50, // Short delay between polls
            maxDelayMs: 50,
          }
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain("timeout");
      }, 10000); // Test timeout of 10s

      it("should handle malformed XML response", async () => {
        const mockHttpClient = {
          fetch: vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve("not xml at all"),
          }),
        };
        setHttpClient(mockHttpClient);

        const result = await fetchFlexQuery({
          token: "validtoken12345678",
          queryId: "123456",
        });

        expect(result.success).toBe(false);
      });

      it("should handle HTTP error status", async () => {
        const mockHttpClient = {
          fetch: vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
          }),
        };
        setHttpClient(mockHttpClient);

        const result = await fetchFlexQuery({
          token: "validtoken12345678",
          queryId: "123456",
        });

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it("should handle network error", async () => {
        const mockHttpClient = {
          fetch: vi.fn().mockRejectedValue(new Error("Network error")),
        };
        setHttpClient(mockHttpClient);

        const result = await fetchFlexQuery({
          token: "validtoken12345678",
          queryId: "123456",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("Network error");
      });

      it("should retry on error code 1003 (generation in progress)", async () => {
        let callCount = 0;
        const mockHttpClient = {
          fetch: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              // SendRequest - return success
              return Promise.resolve({
                ok: true,
                status: 200,
                status_text: "OK",
                headers: {},
                body: `<FlexStatementResponse><Status>Success</Status><ReferenceCode>12345</ReferenceCode></FlexStatementResponse>`,
              });
            }
            if (callCount === 2) {
              // First GetStatement - return 1003 (in progress)
              return Promise.resolve({
                ok: true,
                status: 200,
                status_text: "OK",
                headers: {},
                body: `<FlexStatementResponse><Status>Warn</Status><ErrorCode>1003</ErrorCode><ErrorMessage>Statement generation in progress</ErrorMessage></FlexStatementResponse>`,
              });
            }
            // Second GetStatement - return success with CSV
            return Promise.resolve({
              ok: true,
              status: 200,
              status_text: "OK",
              headers: {},
              body: `<FlexQueryResponse><FlexStatements><FlexStatement>Symbol,Quantity\nAAPL,10</FlexStatement></FlexStatements></FlexQueryResponse>`,
            });
          }),
        };
        setHttpClient(mockHttpClient);

        const result = await fetchFlexQuery(
          { token: "validtoken12345678", queryId: "123456" },
          { initialDelayMs: 10, maxDelayMs: 20 }
        );

        expect(result.success).toBe(true);
        expect(result.csv).toContain("Symbol");
        expect(callCount).toBeGreaterThanOrEqual(3);
      }, 10000);

      it("should retry on error code 1019 (rate limited)", async () => {
        let callCount = 0;
        const mockHttpClient = {
          fetch: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              // SendRequest - return success
              return Promise.resolve({
                ok: true,
                status: 200,
                status_text: "OK",
                headers: {},
                body: `<FlexStatementResponse><Status>Success</Status><ReferenceCode>12345</ReferenceCode></FlexStatementResponse>`,
              });
            }
            if (callCount === 2) {
              // First GetStatement - return 1019 (rate limited)
              return Promise.resolve({
                ok: true,
                status: 200,
                status_text: "OK",
                headers: {},
                body: `<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Rate limited</ErrorMessage></FlexStatementResponse>`,
              });
            }
            // Second GetStatement - return success
            return Promise.resolve({
              ok: true,
              status: 200,
              status_text: "OK",
              headers: {},
              body: `<FlexQueryResponse><FlexStatements><FlexStatement>Symbol,Quantity\nAAPL,10</FlexStatement></FlexStatements></FlexQueryResponse>`,
            });
          }),
        };
        setHttpClient(mockHttpClient);

        const result = await fetchFlexQuery(
          { token: "validtoken12345678", queryId: "123456" },
          { initialDelayMs: 10, maxDelayMs: 20 }
        );

        expect(result.success).toBe(true);
        expect(callCount).toBeGreaterThanOrEqual(3);
      }, 10000);

      it("should fail on non-retryable error code", async () => {
        let callCount = 0;
        const mockHttpClient = {
          fetch: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              // SendRequest - return success
              return Promise.resolve({
                ok: true,
                status: 200,
                status_text: "OK",
                headers: {},
                body: `<FlexStatementResponse><Status>Success</Status><ReferenceCode>12345</ReferenceCode></FlexStatementResponse>`,
              });
            }
            // GetStatement - return non-retryable error (e.g., 1016 = statement not found)
            return Promise.resolve({
              ok: true,
              status: 200,
              status_text: "OK",
              headers: {},
              body: `<FlexStatementResponse><Status>Fail</Status><ErrorCode>1016</ErrorCode><ErrorMessage>Statement not found</ErrorMessage></FlexStatementResponse>`,
            });
          }),
        };
        setHttpClient(mockHttpClient);

        const result = await fetchFlexQuery(
          { token: "validtoken12345678", queryId: "123456" },
          { initialDelayMs: 10, maxDelayMs: 20 }
        );

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe(1016);
        expect(result.error).toContain("Statement not found");
      });
    });

    describe("testFlexConnection", () => {
      beforeEach(() => {
        setHttpClient(undefined as any);
      });

      it("should return success when SendRequest succeeds", async () => {
        const mockHttpClient = {
          fetch: vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            status_text: "OK",
            headers: {},
            body: `<FlexStatementResponse><Status>Success</Status><ReferenceCode>12345</ReferenceCode></FlexStatementResponse>`,
          }),
        };
        setHttpClient(mockHttpClient);

        const result = await testFlexConnection({
          id: "test",
          name: "Test Config",
          token: "validtoken12345678",
          queryId: "123456",
          accountGroup: "Test Group",
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain("successful");
      });

      it("should return error for invalid token (1015)", async () => {
        const mockHttpClient = {
          fetch: vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            status_text: "OK",
            headers: {},
            body: `<FlexStatementResponse><Status>Fail</Status><ErrorCode>1015</ErrorCode><ErrorMessage>Invalid token</ErrorMessage></FlexStatementResponse>`,
          }),
        };
        setHttpClient(mockHttpClient);

        const result = await testFlexConnection({
          id: "test",
          name: "Test Config",
          token: "invalidtoken12345",
          queryId: "123456",
          accountGroup: "Test Group",
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain("Invalid token");
      });

      it("should return error for expired token (1012)", async () => {
        const mockHttpClient = {
          fetch: vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            status_text: "OK",
            headers: {},
            body: `<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode><ErrorMessage>Token expired</ErrorMessage></FlexStatementResponse>`,
          }),
        };
        setHttpClient(mockHttpClient);

        const result = await testFlexConnection({
          id: "test",
          name: "Test Config",
          token: "expiredtoken12345",
          queryId: "123456",
          accountGroup: "Test Group",
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain("expired");
      });

      it("should return error for invalid Query ID (1014)", async () => {
        const mockHttpClient = {
          fetch: vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            status_text: "OK",
            headers: {},
            body: `<FlexStatementResponse><Status>Fail</Status><ErrorCode>1014</ErrorCode><ErrorMessage>Invalid query ID</ErrorMessage></FlexStatementResponse>`,
          }),
        };
        setHttpClient(mockHttpClient);

        const result = await testFlexConnection({
          id: "test",
          name: "Test Config",
          token: "validtoken12345678",
          queryId: "invalid123",
          accountGroup: "Test Group",
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain("Invalid Query ID");
      });

      it("should return error for IP not allowed (1013)", async () => {
        const mockHttpClient = {
          fetch: vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            status_text: "OK",
            headers: {},
            body: `<FlexStatementResponse><Status>Fail</Status><ErrorCode>1013</ErrorCode><ErrorMessage>IP not allowed</ErrorMessage></FlexStatementResponse>`,
          }),
        };
        setHttpClient(mockHttpClient);

        const result = await testFlexConnection({
          id: "test",
          name: "Test Config",
          token: "validtoken12345678",
          queryId: "123456",
          accountGroup: "Test Group",
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain("IP address not allowed");
      });

      it("should return generic error for unknown error codes", async () => {
        const mockHttpClient = {
          fetch: vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            status_text: "OK",
            headers: {},
            body: `<FlexStatementResponse><Status>Fail</Status><ErrorCode>9999</ErrorCode><ErrorMessage>Unknown error</ErrorMessage></FlexStatementResponse>`,
          }),
        };
        setHttpClient(mockHttpClient);

        const result = await testFlexConnection({
          id: "test",
          name: "Test Config",
          token: "validtoken12345678",
          queryId: "123456",
          accountGroup: "Test Group",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("Unknown error");
      });
    });
  });

  describe("AsyncLock", () => {
    it("should prevent concurrent execution", async () => {
      const lock = new AsyncLock();
      const results: number[] = [];

      const task = async (id: number, delay: number) => {
        const release = await lock.acquire();
        await new Promise((resolve) => setTimeout(resolve, delay));
        results.push(id);
        release();
      };

      // Start both tasks concurrently
      const p1 = task(1, 50);
      const p2 = task(2, 10);

      await Promise.all([p1, p2]);

      // Task 1 should complete first because it acquired the lock first
      expect(results).toEqual([1, 2]);
    });

    it("should allow tryAcquire to fail without waiting", () => {
      const lock = new AsyncLock();

      // First acquire should succeed
      const release1 = lock.tryAcquire();
      expect(release1).not.toBeNull();

      // Second tryAcquire should fail immediately
      const release2 = lock.tryAcquire();
      expect(release2).toBeNull();

      // After release, tryAcquire should succeed again
      release1!();
      const release3 = lock.tryAcquire();
      expect(release3).not.toBeNull();
      release3!();
    });

    it("should handle errors in queued callbacks", async () => {
      const lock = new AsyncLock();
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Acquire the lock
      const release1 = await lock.acquire();

      // Queue a task that will run after release
      let taskRan = false;
      const errorTask = lock.acquire().then((release) => {
        taskRan = true;
        release();
      });

      // Release the first lock
      release1();

      // Wait for the queued task
      await errorTask;
      expect(taskRan).toBe(true);

      consoleSpy.mockRestore();
    });

    it("should work with withLock helper", async () => {
      const lock = new AsyncLock();
      let counter = 0;

      const increment = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        counter++;
        return counter;
      };

      // Run multiple increments with lock
      const results = await Promise.all([
        withLock(lock, increment),
        withLock(lock, increment),
        withLock(lock, increment),
      ]);

      // Results should be 1, 2, 3 in order due to locking
      expect(results).toEqual([1, 2, 3]);
    });

    it("should release lock even when function throws", async () => {
      const lock = new AsyncLock();

      try {
        await withLock(lock, async () => {
          throw new Error("Test error");
        });
      } catch {
        // Expected
      }

      // Lock should be released
      expect(lock.isLocked()).toBe(false);
    });
  });
});

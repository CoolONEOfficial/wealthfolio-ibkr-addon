import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isConfigInCooldown,
  createActivityFingerprintGetter,
  createSuccessStatus,
  createPendingStatus,
  createErrorStatus,
  formatImportResultMessage,
  enrichIBKRErrorMessage,
} from "../lib/auto-fetch-helpers";
import { FETCH_COOLDOWN_MS } from "../lib/constants";

describe("Auto-Fetch Helpers", () => {
  describe("isConfigInCooldown", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return not in cooldown when lastFetchTime is undefined", () => {
      const result = isConfigInCooldown(undefined);
      expect(result.inCooldown).toBe(false);
      expect(result.hoursRemaining).toBeUndefined();
    });

    it("should return not in cooldown when lastFetchTime is empty string", () => {
      const result = isConfigInCooldown("");
      expect(result.inCooldown).toBe(false);
    });

    it("should return not in cooldown for invalid date", () => {
      const result = isConfigInCooldown("not-a-date");
      expect(result.inCooldown).toBe(false);
    });

    it("should return in cooldown when within cooldown period", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      // Last fetch was 1 hour ago (within 6 hour cooldown)
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const result = isConfigInCooldown(oneHourAgo);

      expect(result.inCooldown).toBe(true);
      expect(result.hoursRemaining).toBeCloseTo(5, 0); // ~5 hours remaining
    });

    it("should return not in cooldown when cooldown has expired", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      // Last fetch was 7 hours ago (beyond 6 hour cooldown)
      const sevenHoursAgo = new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString();
      const result = isConfigInCooldown(sevenHoursAgo);

      expect(result.inCooldown).toBe(false);
      expect(result.hoursRemaining).toBeUndefined();
    });

    it("should return not in cooldown exactly at cooldown boundary", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      // Last fetch was exactly FETCH_COOLDOWN_MS ago
      const exactlyAtCooldown = new Date(now.getTime() - FETCH_COOLDOWN_MS).toISOString();
      const result = isConfigInCooldown(exactlyAtCooldown);

      expect(result.inCooldown).toBe(false);
    });

    it("should be in cooldown 1ms before cooldown expires", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      // Last fetch was 1ms less than cooldown
      const almostExpired = new Date(now.getTime() - FETCH_COOLDOWN_MS + 1).toISOString();
      const result = isConfigInCooldown(almostExpired);

      expect(result.inCooldown).toBe(true);
    });

    it("should calculate hoursRemaining correctly", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      // Last fetch was 3 hours ago
      const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
      const result = isConfigInCooldown(threeHoursAgo);

      expect(result.inCooldown).toBe(true);
      expect(result.hoursRemaining).toBeCloseTo(3, 0); // ~3 hours remaining
    });

    it("should handle future dates (negative time since)", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      // Future date (shouldn't happen but handle defensively)
      const futureDate = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      const result = isConfigInCooldown(futureDate);

      // Future date means timeSince is negative, so definitely in cooldown
      expect(result.inCooldown).toBe(true);
    });

    it("should handle very old dates", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      // Last fetch was a year ago
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const result = isConfigInCooldown(oneYearAgo);

      expect(result.inCooldown).toBe(false);
    });
  });

  describe("createActivityFingerprintGetter", () => {
    it("should create a function that fetches and maps activities", async () => {
      const mockActivities = [
        {
          date: new Date("2024-01-15"),
          assetSymbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.5,
          amount: 1505,
          fee: 1,
          currency: "USD",
          comment: "Test comment",
        },
      ];

      const mockApi = {
        getAll: vi.fn().mockResolvedValue(mockActivities),
      };

      const getter = createActivityFingerprintGetter(mockApi);
      const result = await getter("account-123");

      expect(mockApi.getAll).toHaveBeenCalledWith("account-123");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        activityDate: "2024-01-15",
        assetId: "AAPL",
        activityType: "BUY",
        quantity: 10,
        unitPrice: 150.5,
        amount: 1505,
        fee: 1,
        currency: "USD",
        comment: "Test comment",
      });
    });

    it("should handle string dates", async () => {
      const mockActivities = [
        {
          date: "2024-01-15",
          assetSymbol: "MSFT",
          activityType: "SELL",
          quantity: 5,
          unitPrice: 200,
          amount: 1000,
          fee: 2,
          currency: "USD",
        },
      ];

      const mockApi = {
        getAll: vi.fn().mockResolvedValue(mockActivities),
      };

      const getter = createActivityFingerprintGetter(mockApi);
      const result = await getter("account-456");

      expect(result[0].activityDate).toBe("2024-01-15");
    });

    it("should handle Date objects and extract date part only", async () => {
      const mockActivities = [
        {
          date: new Date("2024-01-15T14:30:00Z"),
          assetSymbol: "GOOG",
          activityType: "DIVIDEND",
          quantity: 100,
          unitPrice: 0.5,
          amount: 50,
          fee: 0,
          currency: "USD",
        },
      ];

      const mockApi = {
        getAll: vi.fn().mockResolvedValue(mockActivities),
      };

      const getter = createActivityFingerprintGetter(mockApi);
      const result = await getter("account-789");

      // Should strip time portion
      expect(result[0].activityDate).toBe("2024-01-15");
    });

    it("should handle empty activities array", async () => {
      const mockApi = {
        getAll: vi.fn().mockResolvedValue([]),
      };

      const getter = createActivityFingerprintGetter(mockApi);
      const result = await getter("account-empty");

      expect(result).toEqual([]);
    });

    it("should map assetSymbol to assetId", async () => {
      const mockActivities = [
        {
          date: "2024-01-15",
          assetSymbol: "TSLA",
          assetId: "internal-id-123", // This should be ignored
          activityType: "BUY",
          quantity: 1,
          unitPrice: 100,
          fee: 0,
          currency: "USD",
        },
      ];

      const mockApi = {
        getAll: vi.fn().mockResolvedValue(mockActivities),
      };

      const getter = createActivityFingerprintGetter(mockApi);
      const result = await getter("account-xyz");

      // assetId in result should be the symbol, not internal ID
      expect(result[0].assetId).toBe("TSLA");
    });

    it("should include optional fields when present", async () => {
      const mockActivities = [
        {
          date: "2024-01-15",
          assetSymbol: "AAPL",
          activityType: "DIVIDEND",
          quantity: 100,
          unitPrice: 0.24,
          amount: 24,
          fee: 0,
          currency: "USD",
          comment: "Dividend per share: 0.24 USD",
        },
      ];

      const mockApi = {
        getAll: vi.fn().mockResolvedValue(mockActivities),
      };

      const getter = createActivityFingerprintGetter(mockApi);
      const result = await getter("account-div");

      expect(result[0].comment).toBe("Dividend per share: 0.24 USD");
      expect(result[0].amount).toBe(24);
    });

    it("should handle missing optional fields", async () => {
      const mockActivities = [
        {
          date: "2024-01-15",
          assetSymbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150,
          fee: 1,
          currency: "USD",
          // No amount or comment
        },
      ];

      const mockApi = {
        getAll: vi.fn().mockResolvedValue(mockActivities),
      };

      const getter = createActivityFingerprintGetter(mockApi);
      const result = await getter("account-min");

      expect(result[0].amount).toBeUndefined();
      expect(result[0].comment).toBeUndefined();
    });
  });

  describe("createSuccessStatus", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should create success status with current timestamp", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      const status = createSuccessStatus();

      expect(status.lastFetchTime).toBe("2024-01-15T12:00:00.000Z");
      expect(status.lastFetchStatus).toBe("success");
      expect(status.lastFetchError).toBeUndefined();
    });
  });

  describe("createPendingStatus", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should create pending status with current timestamp", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      const status = createPendingStatus();

      expect(status.lastFetchTime).toBe("2024-01-15T12:00:00.000Z");
      // Note: Uses "success" since "pending" isn't a valid status type
      expect(status.lastFetchStatus).toBe("success");
      expect(status.lastFetchError).toBeUndefined();
    });

    it("should claim config before actual fetch to prevent race conditions", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      const pendingStatus = createPendingStatus();

      // Pending status puts config in cooldown immediately
      const cooldownCheck = isConfigInCooldown(pendingStatus.lastFetchTime);
      expect(cooldownCheck.inCooldown).toBe(true);
    });
  });

  describe("createErrorStatus", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should create error status from Error object", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      const error = new Error("Network timeout");
      const status = createErrorStatus(error);

      expect(status.lastFetchTime).toBe("2024-01-15T12:00:00.000Z");
      expect(status.lastFetchStatus).toBe("error");
      expect(status.lastFetchError).toBe("Network timeout");
    });

    it("should create error status from string", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      const status = createErrorStatus("Something went wrong");

      expect(status.lastFetchStatus).toBe("error");
      expect(status.lastFetchError).toBe("Something went wrong");
    });

    it("should handle non-string/non-Error values", () => {
      const status = createErrorStatus({ code: 500 });

      expect(status.lastFetchStatus).toBe("error");
      expect(status.lastFetchError).toBe("[object Object]");
    });

    it("should handle null error", () => {
      const status = createErrorStatus(null);

      expect(status.lastFetchStatus).toBe("error");
      expect(status.lastFetchError).toBe("null");
    });

    it("should handle undefined error", () => {
      const status = createErrorStatus(undefined);

      expect(status.lastFetchStatus).toBe("error");
      expect(status.lastFetchError).toBe("undefined");
    });

    it("should handle number error", () => {
      const status = createErrorStatus(404);

      expect(status.lastFetchStatus).toBe("error");
      expect(status.lastFetchError).toBe("404");
    });
  });

  describe("formatImportResultMessage", () => {
    it("should format message with only imports", () => {
      const message = formatImportResultMessage(10, 0);
      expect(message).toBe("10 transactions imported");
    });

    it("should format message with imports and skipped", () => {
      const message = formatImportResultMessage(10, 5);
      expect(message).toBe("10 transactions imported, 5 duplicates skipped");
    });

    it("should handle zero imports with skipped", () => {
      const message = formatImportResultMessage(0, 5);
      expect(message).toBe("0 transactions imported, 5 duplicates skipped");
    });

    it("should handle zero both", () => {
      const message = formatImportResultMessage(0, 0);
      expect(message).toBe("0 transactions imported");
    });

    it("should handle large numbers", () => {
      const message = formatImportResultMessage(1000, 500);
      expect(message).toBe("1000 transactions imported, 500 duplicates skipped");
    });

    it("should handle single import", () => {
      const message = formatImportResultMessage(1, 0);
      expect(message).toBe("1 transactions imported");
    });

    it("should handle single skip", () => {
      const message = formatImportResultMessage(5, 1);
      expect(message).toBe("5 transactions imported, 1 duplicates skipped");
    });

    it("should include failed count when provided", () => {
      const message = formatImportResultMessage(10, 5, 3);
      expect(message).toBe("10 transactions imported, 5 duplicates skipped, 3 failed");
    });

    it("should include failed count with zero skipped", () => {
      const message = formatImportResultMessage(10, 0, 3);
      expect(message).toBe("10 transactions imported, 3 failed");
    });

    it("should show only failed when no imports or skipped", () => {
      const message = formatImportResultMessage(0, 0, 5);
      expect(message).toBe("0 transactions imported, 5 failed");
    });

    it("should handle single failure", () => {
      const message = formatImportResultMessage(5, 2, 1);
      expect(message).toBe("5 transactions imported, 2 duplicates skipped, 1 failed");
    });

    it("should not include failed when zero (default)", () => {
      const message = formatImportResultMessage(10, 5, 0);
      expect(message).toBe("10 transactions imported, 5 duplicates skipped");
    });
  });

  describe("enrichIBKRErrorMessage", () => {
    it("should enrich 'Token has expired' with actionable guidance", () => {
      const result = enrichIBKRErrorMessage("Token has expired");
      expect(result).toContain("Token has expired");
      expect(result).toContain("IBKR Account Management");
      expect(result).toContain("Flex Token");
    });

    it("should enrich 'Token is invalid' with actionable guidance", () => {
      const result = enrichIBKRErrorMessage("Token is invalid");
      expect(result).toContain("Token is invalid");
      expect(result).toContain("IBKR Account Management");
    });

    it("should enrich IP restriction errors", () => {
      const result = enrichIBKRErrorMessage("IP address restriction violated");
      expect(result).toContain("IP address not allowed");
      expect(result).toContain("IP restrictions");
    });

    it("should enrich 'Query is invalid' with actionable guidance", () => {
      const result = enrichIBKRErrorMessage("Query is invalid");
      expect(result).toContain("Query ID is invalid");
      expect(result).toContain("IBKR Account Management");
    });

    it("should enrich permission errors", () => {
      const result = enrichIBKRErrorMessage("Token missing permissions");
      expect(result).toContain("permissions");
      expect(result).toContain("IBKR Account Management");
    });

    it("should handle partial matches (wrapped errors)", () => {
      const result = enrichIBKRErrorMessage("Error: Token has expired during fetch");
      expect(result).toContain("Generate a new token");
    });

    it("should return original message for unknown errors", () => {
      const unknownError = "Some random network error";
      const result = enrichIBKRErrorMessage(unknownError);
      expect(result).toBe(unknownError);
    });

    it("should return original message for generic errors", () => {
      const genericError = "Connection refused";
      const result = enrichIBKRErrorMessage(genericError);
      expect(result).toBe(genericError);
    });
  });
});

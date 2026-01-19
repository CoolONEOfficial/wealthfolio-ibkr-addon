import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  importActivitiesToAccounts,
  fetchAndParseFlexQuery,
  processFlexQueryConfig,
} from "../lib/auto-fetch-processor";
import type { Account, ActivityImport, AddonContext } from "@wealthfolio/addon-sdk";
import type { FlexQueryConfig } from "../lib/flex-config-storage";

// Mock dependencies
vi.mock("../lib/ibkr-preprocessor", () => ({
  preprocessIBKRData: vi.fn((rows) => ({
    processedData: rows.map((r: Record<string, string>) => ({
      ...r,
      _classification: "TRADE",
    })),
  })),
}));

vi.mock("../lib/import-orchestrator", () => ({
  processAndResolveData: vi.fn().mockResolvedValue({
    activities: [],
    conversionErrors: [],
    skippedCount: 0,
    skippedFXConversions: [],
  }),
}));

vi.mock("../lib/activity-deduplicator", () => ({
  deduplicateActivities: vi.fn().mockResolvedValue({
    toImport: [],
    duplicatesSkipped: 0,
  }),
}));

vi.mock("../lib/auto-fetch-helpers", () => ({
  createActivityFingerprintGetter: vi.fn(() => vi.fn().mockResolvedValue([])),
  createSuccessStatus: vi.fn(() => ({
    lastFetchTime: "2024-01-15T12:00:00.000Z",
    lastFetchStatus: "success",
  })),
  createErrorStatus: vi.fn((error) => ({
    lastFetchTime: "2024-01-15T12:00:00.000Z",
    lastFetchStatus: "error",
    lastFetchError: error?.message || String(error),
  })),
  formatImportResultMessage: vi.fn(
    (imported, skipped, failed) =>
      `${imported} imported, ${skipped} skipped, ${failed} failed`
  ),
  enrichIBKRErrorMessage: vi.fn((msg) => msg),
}));

vi.mock("../lib/flex-query-fetcher", () => ({
  fetchFlexQuery: vi.fn().mockResolvedValue({
    success: true,
    csv: '"Header1","Header2"\n"Value1","Value2"',
  }),
}));

vi.mock("../lib/flex-csv-parser", () => ({
  parseFlexQueryCSV: vi.fn().mockReturnValue({
    rows: [{ Header1: "Value1", Header2: "Value2" }],
    errors: [],
  }),
}));

vi.mock("../lib/currency-detector", () => ({
  detectCurrenciesFromIBKR: vi.fn().mockReturnValue(["USD"]),
}));

vi.mock("../lib/flex-config-storage", () => ({
  updateConfigStatus: vi.fn().mockResolvedValue(undefined),
}));

describe("Auto-Fetch Processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("importActivitiesToAccounts", () => {
    const mockAccount: Account = {
      id: "acc-1",
      name: "Test - USD",
      currency: "USD",
      group: "Test",
      balance: 0,
      isActive: true,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("should import activities successfully", async () => {
      const { deduplicateActivities } = await import(
        "../lib/activity-deduplicator"
      );
      vi.mocked(deduplicateActivities).mockResolvedValueOnce({
        toImport: [
          {
            date: "2024-01-15",
            symbol: "AAPL",
            activityType: "BUY",
            quantity: 10,
            unitPrice: 150,
            fee: 1,
            currency: "USD",
            accountId: "acc-1",
          } as ActivityImport,
        ],
        duplicatesSkipped: 0,
      });

      const mockActivitiesApi = {
        import: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue([]),
      };

      const activities: ActivityImport[] = [
        {
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150,
          fee: 1,
          currency: "USD",
        },
      ];

      const accountsByCurrency = new Map([["USD", mockAccount]]);

      const result = await importActivitiesToAccounts(
        activities,
        ["USD"],
        accountsByCurrency,
        mockActivitiesApi as never,
        "TestConfig"
      );

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockActivitiesApi.import).toHaveBeenCalledTimes(1);
    });

    it("should skip activities for missing currencies", async () => {
      const activities: ActivityImport[] = [
        {
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150,
          fee: 1,
          currency: "EUR", // Account map has USD, not EUR
        },
      ];

      const accountsByCurrency = new Map([["USD", mockAccount]]);

      const result = await importActivitiesToAccounts(
        activities,
        ["USD", "EUR"],
        accountsByCurrency,
        null as never,
        "TestConfig"
      );

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("should handle import errors gracefully", async () => {
      const { deduplicateActivities } = await import(
        "../lib/activity-deduplicator"
      );
      vi.mocked(deduplicateActivities).mockResolvedValueOnce({
        toImport: [
          {
            date: "2024-01-15",
            symbol: "AAPL",
            activityType: "BUY",
            quantity: 10,
            unitPrice: 150,
            fee: 1,
            currency: "USD",
            accountId: "acc-1",
          } as ActivityImport,
        ],
        duplicatesSkipped: 0,
      });

      const mockActivitiesApi = {
        import: vi.fn().mockRejectedValue(new Error("Import failed")),
        getAll: vi.fn().mockResolvedValue([]),
      };

      const activities: ActivityImport[] = [
        {
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150,
          fee: 1,
          currency: "USD",
        },
      ];

      const accountsByCurrency = new Map([["USD", mockAccount]]);
      const mockLogger = { warn: vi.fn(), trace: vi.fn() };

      const result = await importActivitiesToAccounts(
        activities,
        ["USD"],
        accountsByCurrency,
        mockActivitiesApi as never,
        "TestConfig",
        mockLogger as never
      );

      expect(result.failed).toBe(1);
      expect(result.failedAccounts).toContain("Test - USD");
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should handle deduplication correctly", async () => {
      const { deduplicateActivities } = await import(
        "../lib/activity-deduplicator"
      );
      vi.mocked(deduplicateActivities).mockResolvedValueOnce({
        toImport: [],
        duplicatesSkipped: 5,
      });

      const mockActivitiesApi = {
        import: vi.fn(),
        getAll: vi.fn().mockResolvedValue([]),
      };

      const activities: ActivityImport[] = [
        {
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150,
          fee: 1,
          currency: "USD",
        },
      ];

      const accountsByCurrency = new Map([["USD", mockAccount]]);

      const result = await importActivitiesToAccounts(
        activities,
        ["USD"],
        accountsByCurrency,
        mockActivitiesApi as never,
        "TestConfig"
      );

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(5);
      expect(mockActivitiesApi.import).not.toHaveBeenCalled();
    });

    it("should handle empty activities array", async () => {
      const result = await importActivitiesToAccounts(
        [],
        ["USD"],
        new Map([["USD", mockAccount]]),
        null as never,
        "TestConfig"
      );

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("should process multiple currencies", async () => {
      const { deduplicateActivities } = await import(
        "../lib/activity-deduplicator"
      );

      // First call for USD
      vi.mocked(deduplicateActivities).mockResolvedValueOnce({
        toImport: [
          {
            date: "2024-01-15",
            symbol: "AAPL",
            activityType: "BUY",
            quantity: 10,
            unitPrice: 150,
            fee: 1,
            currency: "USD",
            accountId: "acc-usd",
          } as ActivityImport,
        ],
        duplicatesSkipped: 0,
      });

      // Second call for GBP
      vi.mocked(deduplicateActivities).mockResolvedValueOnce({
        toImport: [
          {
            date: "2024-01-15",
            symbol: "VOD",
            activityType: "BUY",
            quantity: 5,
            unitPrice: 100,
            fee: 1,
            currency: "GBP",
            accountId: "acc-gbp",
          } as ActivityImport,
        ],
        duplicatesSkipped: 2,
      });

      const mockActivitiesApi = {
        import: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue([]),
      };

      const gbpAccount: Account = {
        ...mockAccount,
        id: "acc-gbp",
        name: "Test - GBP",
        currency: "GBP",
      };

      const activities: ActivityImport[] = [
        {
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150,
          fee: 1,
          currency: "USD",
        },
        {
          date: "2024-01-15",
          symbol: "VOD",
          activityType: "BUY",
          quantity: 5,
          unitPrice: 100,
          fee: 1,
          currency: "GBP",
        },
      ];

      const accountsByCurrency = new Map([
        ["USD", { ...mockAccount, id: "acc-usd" }],
        ["GBP", gbpAccount],
      ]);

      const result = await importActivitiesToAccounts(
        activities,
        ["USD", "GBP"],
        accountsByCurrency,
        mockActivitiesApi as never,
        "TestConfig"
      );

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(2);
      expect(mockActivitiesApi.import).toHaveBeenCalledTimes(2);
    });
  });

  describe("fetchAndParseFlexQuery", () => {
    it("should fetch and parse CSV successfully", async () => {
      const { fetchFlexQuery } = await import("../lib/flex-query-fetcher");
      const { parseFlexQueryCSV } = await import("../lib/flex-csv-parser");

      vi.mocked(fetchFlexQuery).mockResolvedValueOnce({
        success: true,
        csv: '"Symbol","Quantity"\n"AAPL","10"',
      });

      vi.mocked(parseFlexQueryCSV).mockReturnValueOnce({
        rows: [{ Symbol: "AAPL", Quantity: "10" }],
        errors: [],
      });

      const result = await fetchAndParseFlexQuery(
        "test-token",
        "12345",
        "Test Config"
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].Symbol).toBe("AAPL");
      }
    });

    it("should return error when fetch fails", async () => {
      const { fetchFlexQuery } = await import("../lib/flex-query-fetcher");

      vi.mocked(fetchFlexQuery).mockResolvedValueOnce({
        success: false,
        error: "Network error",
      });

      const result = await fetchAndParseFlexQuery(
        "test-token",
        "12345",
        "Test Config"
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Network error");
      }
    });

    it("should return error when no CSV returned", async () => {
      const { fetchFlexQuery } = await import("../lib/flex-query-fetcher");

      vi.mocked(fetchFlexQuery).mockResolvedValueOnce({
        success: true,
        csv: undefined,
      });

      const result = await fetchAndParseFlexQuery(
        "test-token",
        "12345",
        "Test Config"
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Fetch failed");
      }
    });

    it("should log parse warnings", async () => {
      const { fetchFlexQuery } = await import("../lib/flex-query-fetcher");
      const { parseFlexQueryCSV } = await import("../lib/flex-csv-parser");

      vi.mocked(fetchFlexQuery).mockResolvedValueOnce({
        success: true,
        csv: '"Symbol"\n"AAPL"',
      });

      vi.mocked(parseFlexQueryCSV).mockReturnValueOnce({
        rows: [{ Symbol: "AAPL" }],
        errors: ["Warning: Missing column"],
      });

      const mockLogger = {
        trace: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
      };

      const result = await fetchAndParseFlexQuery(
        "test-token",
        "12345",
        "Test Config",
        mockLogger
      );

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Parse warnings")
      );
    });
  });

  describe("processFlexQueryConfig", () => {
    const mockConfig: FlexQueryConfig = {
      id: "config-1",
      name: "Test Config",
      queryId: "12345",
      accountGroup: "Test Group",
    };

    const mockAccount: Account = {
      id: "acc-1",
      name: "Test Group - USD",
      currency: "USD",
      group: "Test Group",
      balance: 0,
      isActive: true,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const createMockContext = () => ({
      api: {
        logger: {
          trace: vi.fn(),
          warn: vi.fn(),
          info: vi.fn(),
          error: vi.fn(),
        },
        activities: {
          import: vi.fn().mockResolvedValue(undefined),
          getAll: vi.fn().mockResolvedValue([]),
        },
        secrets: {
          get: vi.fn(),
          set: vi.fn(),
        },
      },
    });

    it("should process config successfully with no transactions", async () => {
      const { fetchFlexQuery } = await import("../lib/flex-query-fetcher");
      const { parseFlexQueryCSV } = await import("../lib/flex-csv-parser");

      vi.mocked(fetchFlexQuery).mockResolvedValueOnce({
        success: true,
        csv: '"Header"\n',
      });

      vi.mocked(parseFlexQueryCSV).mockReturnValueOnce({
        rows: [],
        errors: [],
      });

      const mockCtx = createMockContext();
      const result = await processFlexQueryConfig(mockConfig, {
        ctx: mockCtx as unknown as AddonContext,
        token: "test-token",
        getOrCreateAccountsForGroup: vi.fn().mockResolvedValue(new Map()),
      });

      expect(result.success).toBe(true);
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("should process config and import activities", async () => {
      const { fetchFlexQuery } = await import("../lib/flex-query-fetcher");
      const { parseFlexQueryCSV } = await import("../lib/flex-csv-parser");
      const { processAndResolveData } = await import("../lib/import-orchestrator");
      const { deduplicateActivities } = await import("../lib/activity-deduplicator");

      vi.mocked(fetchFlexQuery).mockResolvedValueOnce({
        success: true,
        csv: '"Symbol","Quantity"\n"AAPL","10"',
      });

      vi.mocked(parseFlexQueryCSV).mockReturnValueOnce({
        rows: [{ Symbol: "AAPL", Quantity: "10", CurrencyPrimary: "USD" }],
        errors: [],
      });

      vi.mocked(processAndResolveData).mockResolvedValueOnce({
        activities: [
          {
            date: "2024-01-15",
            symbol: "AAPL",
            activityType: "BUY",
            quantity: 10,
            unitPrice: 150,
            fee: 1,
            currency: "USD",
          } as ActivityImport,
        ],
        conversionErrors: [],
        skippedCount: 0,
        skippedFXConversions: [],
      });

      vi.mocked(deduplicateActivities).mockResolvedValueOnce({
        toImport: [
          {
            date: "2024-01-15",
            symbol: "AAPL",
            activityType: "BUY",
            quantity: 10,
            unitPrice: 150,
            fee: 1,
            currency: "USD",
            accountId: "acc-1",
          } as ActivityImport,
        ],
        duplicatesSkipped: 0,
      });

      const mockCtx = createMockContext();
      const result = await processFlexQueryConfig(mockConfig, {
        ctx: mockCtx as unknown as AddonContext,
        token: "test-token",
        getOrCreateAccountsForGroup: vi.fn().mockResolvedValue(
          new Map([["USD", mockAccount]])
        ),
      });

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
      expect(mockCtx.api.activities.import).toHaveBeenCalled();
    });

    it("should handle fetch errors gracefully", async () => {
      const { fetchFlexQuery } = await import("../lib/flex-query-fetcher");

      vi.mocked(fetchFlexQuery).mockResolvedValueOnce({
        success: false,
        error: "Token expired",
      });

      const mockCtx = createMockContext();
      const result = await processFlexQueryConfig(mockConfig, {
        ctx: mockCtx as unknown as AddonContext,
        token: "test-token",
        getOrCreateAccountsForGroup: vi.fn(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Token expired");
      expect(mockCtx.api.logger.error).toHaveBeenCalled();
    });

    it("should handle partial failures with warning", async () => {
      const { fetchFlexQuery } = await import("../lib/flex-query-fetcher");
      const { parseFlexQueryCSV } = await import("../lib/flex-csv-parser");
      const { processAndResolveData } = await import("../lib/import-orchestrator");
      const { deduplicateActivities } = await import("../lib/activity-deduplicator");

      vi.mocked(fetchFlexQuery).mockResolvedValueOnce({
        success: true,
        csv: '"Symbol","Quantity"\n"AAPL","10"',
      });

      vi.mocked(parseFlexQueryCSV).mockReturnValueOnce({
        rows: [{ Symbol: "AAPL", Quantity: "10", CurrencyPrimary: "USD" }],
        errors: [],
      });

      vi.mocked(processAndResolveData).mockResolvedValueOnce({
        activities: [
          {
            date: "2024-01-15",
            symbol: "AAPL",
            activityType: "BUY",
            quantity: 10,
            unitPrice: 150,
            fee: 1,
            currency: "USD",
          } as ActivityImport,
        ],
        conversionErrors: [],
        skippedCount: 0,
        skippedFXConversions: [],
      });

      vi.mocked(deduplicateActivities).mockResolvedValueOnce({
        toImport: [
          {
            date: "2024-01-15",
            symbol: "AAPL",
            activityType: "BUY",
            quantity: 10,
            unitPrice: 150,
            fee: 1,
            currency: "USD",
            accountId: "acc-1",
          } as ActivityImport,
        ],
        duplicatesSkipped: 0,
      });

      const mockCtx = createMockContext();
      // Make import fail
      mockCtx.api.activities.import = vi.fn().mockRejectedValue(new Error("Import failed"));

      const result = await processFlexQueryConfig(mockConfig, {
        ctx: mockCtx as unknown as AddonContext,
        token: "test-token",
        getOrCreateAccountsForGroup: vi.fn().mockResolvedValue(
          new Map([["USD", mockAccount]])
        ),
      });

      expect(result.success).toBe(true);
      expect(result.failed).toBe(1);
      expect(result.failedAccounts).toContain("Test Group - USD");
    });

    it("should skip duplicates correctly", async () => {
      const { fetchFlexQuery } = await import("../lib/flex-query-fetcher");
      const { parseFlexQueryCSV } = await import("../lib/flex-csv-parser");
      const { processAndResolveData } = await import("../lib/import-orchestrator");
      const { deduplicateActivities } = await import("../lib/activity-deduplicator");

      vi.mocked(fetchFlexQuery).mockResolvedValueOnce({
        success: true,
        csv: '"Symbol","Quantity"\n"AAPL","10"',
      });

      vi.mocked(parseFlexQueryCSV).mockReturnValueOnce({
        rows: [{ Symbol: "AAPL", Quantity: "10", CurrencyPrimary: "USD" }],
        errors: [],
      });

      vi.mocked(processAndResolveData).mockResolvedValueOnce({
        activities: [
          {
            date: "2024-01-15",
            symbol: "AAPL",
            activityType: "BUY",
            quantity: 10,
            unitPrice: 150,
            fee: 1,
            currency: "USD",
          } as ActivityImport,
        ],
        conversionErrors: [],
        skippedCount: 0,
        skippedFXConversions: [],
      });

      // All activities are duplicates
      vi.mocked(deduplicateActivities).mockResolvedValueOnce({
        toImport: [],
        duplicatesSkipped: 5,
      });

      const mockCtx = createMockContext();
      const result = await processFlexQueryConfig(mockConfig, {
        ctx: mockCtx as unknown as AddonContext,
        token: "test-token",
        getOrCreateAccountsForGroup: vi.fn().mockResolvedValue(
          new Map([["USD", mockAccount]])
        ),
      });

      expect(result.success).toBe(true);
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(5);
      expect(mockCtx.api.activities.import).not.toHaveBeenCalled();
    });

    it("should handle success status save failure gracefully", async () => {
      const { fetchFlexQuery } = await import("../lib/flex-query-fetcher");
      const { parseFlexQueryCSV } = await import("../lib/flex-csv-parser");
      const { updateConfigStatus } = await import("../lib/flex-config-storage");

      vi.mocked(fetchFlexQuery).mockResolvedValueOnce({
        success: true,
        csv: '"Header"\n',
      });

      vi.mocked(parseFlexQueryCSV).mockReturnValueOnce({
        rows: [],
        errors: [],
      });

      // Make status save fail
      vi.mocked(updateConfigStatus).mockRejectedValueOnce(
        new Error("Failed to save status")
      );

      const mockCtx = createMockContext();
      const result = await processFlexQueryConfig(mockConfig, {
        ctx: mockCtx as unknown as AddonContext,
        token: "test-token",
        getOrCreateAccountsForGroup: vi.fn().mockResolvedValue(new Map()),
      });

      // Should still succeed even if status save fails
      expect(result.success).toBe(true);
      expect(result.imported).toBe(0);
      expect(mockCtx.api.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save")
      );
    });

    it("should handle error status save failure gracefully", async () => {
      const { fetchFlexQuery } = await import("../lib/flex-query-fetcher");
      const { updateConfigStatus } = await import("../lib/flex-config-storage");

      vi.mocked(fetchFlexQuery).mockResolvedValueOnce({
        success: false,
        error: "Token expired",
      });

      // Make status save fail too
      vi.mocked(updateConfigStatus).mockRejectedValueOnce(
        new Error("Failed to save error status")
      );

      const mockCtx = createMockContext();
      const result = await processFlexQueryConfig(mockConfig, {
        ctx: mockCtx as unknown as AddonContext,
        token: "test-token",
        getOrCreateAccountsForGroup: vi.fn(),
      });

      // Should report the original error even if status save fails
      expect(result.success).toBe(false);
      expect(result.error).toBe("Token expired");
      expect(mockCtx.api.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save error status")
      );
    });

    it("should log conversion errors when present", async () => {
      const { fetchFlexQuery } = await import("../lib/flex-query-fetcher");
      const { parseFlexQueryCSV } = await import("../lib/flex-csv-parser");
      const { processAndResolveData } = await import("../lib/import-orchestrator");

      vi.mocked(fetchFlexQuery).mockResolvedValueOnce({
        success: true,
        csv: '"Symbol","Quantity"\n"AAPL","10"',
      });

      vi.mocked(parseFlexQueryCSV).mockReturnValueOnce({
        rows: [{ Symbol: "AAPL", Quantity: "10", CurrencyPrimary: "USD" }],
        errors: [],
      });

      vi.mocked(processAndResolveData).mockResolvedValueOnce({
        activities: [],
        conversionErrors: [
          { row: 1, message: "Invalid quantity" },
          { row: 2, message: "Missing currency" },
        ],
        skippedCount: 2,
        skippedFXConversions: [],
      });

      const mockCtx = createMockContext();
      const result = await processFlexQueryConfig(mockConfig, {
        ctx: mockCtx as unknown as AddonContext,
        token: "test-token",
        getOrCreateAccountsForGroup: vi.fn().mockResolvedValue(
          new Map([["USD", mockAccount]])
        ),
      });

      expect(result.success).toBe(true);
      expect(mockCtx.api.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("2 conversion error(s)")
      );
    });
  });
});

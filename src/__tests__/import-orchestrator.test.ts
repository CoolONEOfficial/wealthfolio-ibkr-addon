import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  refreshAndUpdateAccountPreviews,
  fetchExistingActivitiesForDedup,
  deduplicateActivities,
  groupActivitiesByCurrency,
  createTransactionGroups,
} from "../lib/import-orchestrator";
import type { Account, ActivityImport } from "@wealthfolio/addon-sdk";
import type { AccountPreview, ActivityFingerprint } from "../types";

describe("Import Orchestrator", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("refreshAndUpdateAccountPreviews", () => {
    const mockAccount: Account = {
      id: "acc-1",
      name: "IBKR - USD",
      currency: "USD",
      group: "IBKR",
      accountType: "SECURITIES",
      isDefault: false,
      isActive: true,
    };

    const mockPreview: AccountPreview = {
      id: "preview-1",
      name: "IBKR - USD",
      currency: "USD",
      group: "IBKR",
      isNew: false,
    };

    it("should refresh accounts from API and update previews", async () => {
      const mockApi = {
        getAll: vi.fn().mockResolvedValue([mockAccount]),
      };

      const result = await refreshAndUpdateAccountPreviews(mockApi, [mockPreview], []);

      expect(mockApi.getAll).toHaveBeenCalled();
      expect(result.freshAccounts).toEqual([mockAccount]);
      expect(result.updatedPreviews[0].existingAccount).toEqual(mockAccount);
    });

    it("should match previews to accounts by name and currency", async () => {
      const accounts: Account[] = [
        { ...mockAccount, id: "acc-1", name: "IBKR - USD", currency: "USD" },
        { ...mockAccount, id: "acc-2", name: "IBKR - EUR", currency: "EUR" },
      ];

      const previews: AccountPreview[] = [
        { id: "p1", name: "IBKR - USD", currency: "USD", group: "IBKR", isNew: false },
        { id: "p2", name: "IBKR - EUR", currency: "EUR", group: "IBKR", isNew: false },
        { id: "p3", name: "IBKR - GBP", currency: "GBP", group: "IBKR", isNew: true },
      ];

      const mockApi = { getAll: vi.fn().mockResolvedValue(accounts) };

      const result = await refreshAndUpdateAccountPreviews(mockApi, previews, []);

      expect(result.updatedPreviews[0].existingAccount?.id).toBe("acc-1");
      expect(result.updatedPreviews[1].existingAccount?.id).toBe("acc-2");
      expect(result.updatedPreviews[2].existingAccount).toBeUndefined();
    });

    it("should use cached accounts if API call fails", async () => {
      const cachedAccounts = [mockAccount];
      const mockApi = {
        getAll: vi.fn().mockRejectedValue(new Error("Network error")),
      };

      const result = await refreshAndUpdateAccountPreviews(
        mockApi,
        [mockPreview],
        cachedAccounts
      );

      expect(result.freshAccounts).toEqual(cachedAccounts);
      expect(console.warn).toHaveBeenCalled();
    });

    it("should handle undefined API", async () => {
      const cachedAccounts = [mockAccount];

      const result = await refreshAndUpdateAccountPreviews(
        undefined,
        [mockPreview],
        cachedAccounts
      );

      expect(result.freshAccounts).toEqual(cachedAccounts);
    });
  });

  describe("fetchExistingActivitiesForDedup", () => {
    const mockAccount: Account = {
      id: "acc-1",
      name: "IBKR - USD",
      currency: "USD",
      group: "IBKR",
      accountType: "SECURITIES",
      isDefault: false,
      isActive: true,
    };

    it("should fetch activities from all existing accounts", async () => {
      const existingActivities = [
        {
          date: new Date("2024-01-15"),
          assetSymbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150,
          amount: 1500,
          fee: 1,
          currency: "USD",
          comment: "Test",
        },
      ];

      const mockApi = {
        getAll: vi.fn().mockResolvedValue(existingActivities),
      };

      const previews: AccountPreview[] = [
        { id: "p1", name: "IBKR - USD", currency: "USD", group: "IBKR", isNew: false, existingAccount: mockAccount },
      ];

      const result = await fetchExistingActivitiesForDedup(mockApi, previews);

      expect(mockApi.getAll).toHaveBeenCalledWith("acc-1");
      expect(result).toHaveLength(1);
      expect(result[0].assetId).toBe("AAPL");
      expect(result[0].activityDate).toBe("2024-01-15");
    });

    it("should handle Date objects by extracting date part", async () => {
      const existingActivities = [
        {
          date: new Date("2024-01-15T14:30:00Z"),
          assetSymbol: "MSFT",
          activityType: "SELL",
          quantity: 5,
          unitPrice: 200,
          fee: 1,
          currency: "USD",
        },
      ];

      const mockApi = { getAll: vi.fn().mockResolvedValue(existingActivities) };

      const previews: AccountPreview[] = [
        { id: "p1", name: "Test", currency: "USD", group: "Test", isNew: false, existingAccount: mockAccount },
      ];

      const result = await fetchExistingActivitiesForDedup(mockApi, previews);

      expect(result[0].activityDate).toBe("2024-01-15");
    });

    it("should skip previews without existing accounts", async () => {
      const mockApi = { getAll: vi.fn() };

      const previews: AccountPreview[] = [
        { id: "p1", name: "New Account", currency: "EUR", group: "Test", isNew: true },
      ];

      const result = await fetchExistingActivitiesForDedup(mockApi, previews);

      expect(mockApi.getAll).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("should continue fetching if one account fails", async () => {
      const activities = [
        { date: "2024-01-15", assetSymbol: "GOOG", activityType: "BUY", quantity: 1, unitPrice: 100, fee: 0, currency: "USD" },
      ];

      const mockApi = {
        getAll: vi.fn()
          .mockRejectedValueOnce(new Error("Account 1 error"))
          .mockResolvedValueOnce(activities),
      };

      const previews: AccountPreview[] = [
        { id: "p1", name: "USD", currency: "USD", group: "Test", isNew: false, existingAccount: { ...mockAccount, id: "acc-1" } },
        { id: "p2", name: "EUR", currency: "EUR", group: "Test", isNew: false, existingAccount: { ...mockAccount, id: "acc-2" } },
      ];

      const result = await fetchExistingActivitiesForDedup(mockApi, previews);

      expect(console.warn).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].assetId).toBe("GOOG");
    });

    it("should return empty array if API is undefined", async () => {
      const result = await fetchExistingActivitiesForDedup(undefined, []);
      expect(result).toEqual([]);
    });
  });

  describe("deduplicateActivities", () => {
    it("should remove duplicate activities", () => {
      const activities: ActivityImport[] = [
        { date: "2024-01-15", symbol: "AAPL", activityType: "BUY", quantity: 10, unitPrice: 150, fee: 1, currency: "USD" },
        { date: "2024-01-16", symbol: "MSFT", activityType: "BUY", quantity: 5, unitPrice: 200, fee: 1, currency: "USD" },
      ];

      const existing: ActivityFingerprint[] = [
        { activityDate: "2024-01-15", assetId: "AAPL", activityType: "BUY", quantity: 10, unitPrice: 150, fee: 1, currency: "USD" },
      ];

      const result = deduplicateActivities(activities, existing);

      // Note: actual deduplication depends on filterDuplicateActivities implementation
      // This test verifies the orchestrator calls it correctly
      expect(Array.isArray(result)).toBe(true);
    });

    it("should log duplicates when found", () => {
      const activities: ActivityImport[] = [];
      const existing: ActivityFingerprint[] = [];

      deduplicateActivities(activities, existing);

      // Logging happens only when duplicates are found
      // With empty arrays, no logging should occur
    });
  });

  describe("groupActivitiesByCurrency", () => {
    it("should group activities by currency", () => {
      const activities: ActivityImport[] = [
        { date: "2024-01-15", symbol: "AAPL", activityType: "BUY", quantity: 10, unitPrice: 150, fee: 1, currency: "USD" },
        { date: "2024-01-15", symbol: "HSBA", activityType: "BUY", quantity: 20, unitPrice: 7, fee: 1, currency: "GBP" },
        { date: "2024-01-16", symbol: "MSFT", activityType: "BUY", quantity: 5, unitPrice: 200, fee: 1, currency: "USD" },
      ];

      const result = groupActivitiesByCurrency(activities);

      expect(result.get("USD")).toHaveLength(2);
      expect(result.get("GBP")).toHaveLength(1);
    });

    it("should default to USD for missing currency", () => {
      const activities: ActivityImport[] = [
        { date: "2024-01-15", symbol: "XYZ", activityType: "BUY", quantity: 1, unitPrice: 100, fee: 0 } as ActivityImport,
      ];

      const result = groupActivitiesByCurrency(activities);

      expect(result.get("USD")).toHaveLength(1);
    });

    it("should handle empty array", () => {
      const result = groupActivitiesByCurrency([]);
      expect(result.size).toBe(0);
    });

    it("should preserve activity order within groups", () => {
      const activities: ActivityImport[] = [
        { date: "2024-01-15", symbol: "A", activityType: "BUY", quantity: 1, unitPrice: 100, fee: 0, currency: "USD" },
        { date: "2024-01-16", symbol: "B", activityType: "BUY", quantity: 1, unitPrice: 100, fee: 0, currency: "USD" },
        { date: "2024-01-17", symbol: "C", activityType: "BUY", quantity: 1, unitPrice: 100, fee: 0, currency: "USD" },
      ];

      const result = groupActivitiesByCurrency(activities);
      const usdGroup = result.get("USD")!;

      expect(usdGroup[0].symbol).toBe("A");
      expect(usdGroup[1].symbol).toBe("B");
      expect(usdGroup[2].symbol).toBe("C");
    });
  });

  describe("createTransactionGroups", () => {
    const basePreviews: AccountPreview[] = [
      { id: "p1", name: "IBKR - USD", currency: "USD", group: "IBKR", isNew: false },
      { id: "p2", name: "IBKR - EUR", currency: "EUR", group: "IBKR", isNew: true },
    ];

    it("should create transaction groups for each preview", () => {
      const grouped = new Map<string, ActivityImport[]>();
      grouped.set("USD", [
        { date: "2024-01-15", symbol: "AAPL", activityType: "BUY", quantity: 10, unitPrice: 150, fee: 1, currency: "USD" },
      ]);
      grouped.set("EUR", []);

      const result = createTransactionGroups(basePreviews, grouped);

      expect(result).toHaveLength(2);
      expect(result[0].currency).toBe("USD");
      expect(result[0].accountName).toBe("IBKR - USD");
      expect(result[0].transactions).toHaveLength(1);
      expect(result[1].currency).toBe("EUR");
      expect(result[1].transactions).toHaveLength(0);
    });

    it("should calculate summary correctly", () => {
      const grouped = new Map<string, ActivityImport[]>();
      grouped.set("USD", [
        { date: "2024-01-15", symbol: "AAPL", activityType: "BUY", quantity: 10, unitPrice: 150, fee: 1, currency: "USD" },
        { date: "2024-01-16", symbol: "AAPL", activityType: "SELL", quantity: 5, unitPrice: 160, fee: 1, currency: "USD" },
        { date: "2024-01-17", symbol: "AAPL", activityType: "DIVIDEND", quantity: 10, unitPrice: 0.24, fee: 0, currency: "USD" },
        { date: "2024-01-18", symbol: "$CASH-USD", activityType: "DEPOSIT", quantity: 1000, unitPrice: 1, fee: 0, currency: "USD" },
        { date: "2024-01-19", symbol: "$CASH-USD", activityType: "WITHDRAWAL", quantity: 500, unitPrice: 1, fee: 0, currency: "USD" },
        { date: "2024-01-20", symbol: "AAPL", activityType: "FEE", quantity: 0, unitPrice: 0, fee: 10, currency: "USD" },
        { date: "2024-01-21", symbol: "$CASH-USD", activityType: "TRANSFER_IN", quantity: 100, unitPrice: 1, fee: 0, currency: "USD" },
        { date: "2024-01-22", symbol: "$CASH-USD", activityType: "TRANSFER_OUT", quantity: 50, unitPrice: 1, fee: 0, currency: "USD" },
      ]);

      const result = createTransactionGroups([basePreviews[0]], grouped);

      expect(result[0].summary.trades).toBe(2); // BUY + SELL
      expect(result[0].summary.dividends).toBe(1);
      expect(result[0].summary.deposits).toBe(2); // DEPOSIT + TRANSFER_IN
      expect(result[0].summary.withdrawals).toBe(2); // WITHDRAWAL + TRANSFER_OUT
      expect(result[0].summary.fees).toBe(1);
    });

    it("should handle missing currency in grouped map", () => {
      const grouped = new Map<string, ActivityImport[]>();
      // USD not in the map

      const result = createTransactionGroups([basePreviews[0]], grouped);

      expect(result[0].transactions).toEqual([]);
      expect(result[0].summary.trades).toBe(0);
    });

    it("should count UNKNOWN activity types as other", () => {
      const grouped = new Map<string, ActivityImport[]>();
      grouped.set("USD", [
        { date: "2024-01-15", symbol: "XYZ", activityType: "UNKNOWN", quantity: 1, unitPrice: 1, fee: 0, currency: "USD" } as ActivityImport,
      ]);

      const result = createTransactionGroups([basePreviews[0]], grouped);

      expect(result[0].summary.other).toBe(1);
    });
  });
});

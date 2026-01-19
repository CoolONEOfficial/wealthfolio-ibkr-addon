import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { splitFXConversions } from "../lib/fx-transaction-splitter";
import type { Account, ActivityImport } from "@wealthfolio/addon-sdk";

describe("FX Transaction Splitter", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockAccount = (currency: string): Account => ({
    id: `acc-${currency}`,
    name: `Test - ${currency}`,
    currency,
    group: "Test",
    accountType: "SECURITIES",
    isDefault: false,
    isActive: true,
  });

  const createFXTransaction = (
    symbol: string,
    quantity: number,
    unitPrice: number,
    comment?: string
  ): ActivityImport => ({
    date: "2024-01-15",
    symbol,
    activityType: "BUY",
    quantity,
    unitPrice,
    amount: Math.abs(quantity * unitPrice),
    fee: 0,
    currency: "USD",
    accountId: "acc-1",
    isValid: true,
    isDraft: false,
    comment,
  });

  describe("Input validation", () => {
    it("should handle null transactions input", () => {
      const accountsByCurrency = new Map<string, Account>();
      const result = splitFXConversions(null as unknown as ActivityImport[], accountsByCurrency);

      expect(result.transactions).toEqual([]);
      expect(result.skippedConversions).toEqual([]);
      expect(result.totalFXConversions).toBe(0);
    });

    it("should handle undefined transactions input", () => {
      const accountsByCurrency = new Map<string, Account>();
      const result = splitFXConversions(undefined as unknown as ActivityImport[], accountsByCurrency);

      expect(result.transactions).toEqual([]);
      expect(result.skippedConversions).toEqual([]);
    });

    it("should handle non-array transactions input", () => {
      const accountsByCurrency = new Map<string, Account>();
      const result = splitFXConversions({} as unknown as ActivityImport[], accountsByCurrency);

      expect(result.transactions).toEqual([]);
    });

    it("should handle null accountsByCurrency input", () => {
      const transactions = [createFXTransaction("GBP.USD", -100, 1.26)];
      const result = splitFXConversions(transactions, null as unknown as Map<string, Account>);

      // Should pass through transactions unchanged
      expect(result.transactions).toEqual(transactions);
      expect(result.totalFXConversions).toBe(0);
    });

    it("should handle non-Map accountsByCurrency input", () => {
      const transactions = [createFXTransaction("GBP.USD", -100, 1.26)];
      const result = splitFXConversions(transactions, {} as unknown as Map<string, Account>);

      // Should pass through transactions unchanged
      expect(result.transactions).toEqual(transactions);
    });

    it("should skip null transactions in array", () => {
      const accountsByCurrency = new Map<string, Account>();
      accountsByCurrency.set("GBP", createMockAccount("GBP"));
      accountsByCurrency.set("USD", createMockAccount("USD"));

      const validTx = createFXTransaction("GBP.USD", -100, 1.26);
      const transactions = [null, validTx, undefined] as unknown as ActivityImport[];

      const result = splitFXConversions(transactions, accountsByCurrency);

      // Should process valid transaction and skip nulls
      expect(result.successfulSplits).toBe(1);
      expect(result.transactions).toHaveLength(2); // withdrawal + deposit
    });
  });

  describe("FX symbol parsing", () => {
    it("should not detect symbol without dot as FX (passes through unchanged)", () => {
      const accountsByCurrency = new Map<string, Account>();
      accountsByCurrency.set("GBP", createMockAccount("GBP"));
      accountsByCurrency.set("USD", createMockAccount("USD"));

      // Symbol without dot - won't be detected as FX even with comment
      // (isFXConversion requires dot in symbol for comment-based detection)
      const transaction = createFXTransaction("GBPUSD", -100, 1.26, "forex trade via idealfx");

      const result = splitFXConversions([transaction], accountsByCurrency);

      // Not detected as FX, so passed through unchanged
      expect(result.totalFXConversions).toBe(0);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].symbol).toBe("GBPUSD");
    });

    it("should handle FX symbol with only one part after split (single currency)", () => {
      const accountsByCurrency = new Map<string, Account>();
      accountsByCurrency.set("GBP", createMockAccount("GBP"));
      accountsByCurrency.set("USD", createMockAccount("USD"));

      // Symbol that triggers FOREX detection but has only one part after split (empty second part)
      // "GBP." splits to ["GBP", ""] - still 2 parts but second is empty, fails currency validation
      const transaction: ActivityImport = {
        ...createFXTransaction("GBP.", -100, 1.26),
        comment: "forex trade",
      };

      const result = splitFXConversions([transaction], accountsByCurrency);

      expect(result.skippedConversions).toHaveLength(1);
      expect(result.skippedConversions[0].reason).toContain("could not parse");
    });

    it("should handle FX symbol with multiple dots (3+ parts)", () => {
      const accountsByCurrency = new Map<string, Account>();
      accountsByCurrency.set("GBP", createMockAccount("GBP"));
      accountsByCurrency.set("USD", createMockAccount("USD"));

      // Symbol with multiple dots that triggers FOREX detection
      const transaction: ActivityImport = {
        ...createFXTransaction("GBP.USD.EUR", -100, 1.26),
        comment: "forex trade",
      };

      const result = splitFXConversions([transaction], accountsByCurrency);

      expect(result.skippedConversions).toHaveLength(1);
      expect(result.skippedConversions[0].reason).toContain("could not parse");
    });

    it("should handle invalid currency codes (lowercase)", () => {
      const accountsByCurrency = new Map<string, Account>();
      accountsByCurrency.set("gbp", createMockAccount("gbp"));
      accountsByCurrency.set("usd", createMockAccount("usd"));

      // Symbol with lowercase that passes FOREX detection via comment
      const transaction: ActivityImport = {
        ...createFXTransaction("gbp.usd", -100, 1.26),
        comment: "forex trade",
      };

      const result = splitFXConversions([transaction], accountsByCurrency);

      expect(result.skippedConversions).toHaveLength(1);
      expect(result.skippedConversions[0].reason).toContain("could not parse");
    });

    it("should handle invalid currency codes (too short)", () => {
      const accountsByCurrency = new Map<string, Account>();
      accountsByCurrency.set("GB", createMockAccount("GB"));
      accountsByCurrency.set("US", createMockAccount("US"));

      // Symbol with 2-letter codes that passes FOREX detection via comment
      const transaction: ActivityImport = {
        ...createFXTransaction("GB.US", -100, 1.26),
        comment: "forex trade via idealfx",
      };

      const result = splitFXConversions([transaction], accountsByCurrency);

      expect(result.skippedConversions).toHaveLength(1);
      expect(result.skippedConversions[0].reason).toContain("could not parse");
    });

    it("should handle invalid currency codes (too long)", () => {
      const accountsByCurrency = new Map<string, Account>();
      accountsByCurrency.set("GBPP", createMockAccount("GBPP"));
      accountsByCurrency.set("USDD", createMockAccount("USDD"));

      // Symbol with 4-letter codes that passes FOREX detection via comment
      const transaction: ActivityImport = {
        ...createFXTransaction("GBPP.USDD", -100, 1.26),
        comment: "forex trade",
      };

      const result = splitFXConversions([transaction], accountsByCurrency);

      expect(result.skippedConversions).toHaveLength(1);
      expect(result.skippedConversions[0].reason).toContain("could not parse");
    });

    it("should handle currency codes with numbers", () => {
      const accountsByCurrency = new Map<string, Account>();
      accountsByCurrency.set("GB1", createMockAccount("GB1"));
      accountsByCurrency.set("US2", createMockAccount("US2"));

      // Symbol with numbers that passes FOREX detection via comment
      const transaction: ActivityImport = {
        ...createFXTransaction("GB1.US2", -100, 1.26),
        comment: "forex trade",
      };

      const result = splitFXConversions([transaction], accountsByCurrency);

      expect(result.skippedConversions).toHaveLength(1);
      expect(result.skippedConversions[0].reason).toContain("could not parse");
    });
  });

  describe("Account validation", () => {
    it("should skip FX conversion when source account is missing", () => {
      const accountsByCurrency = new Map<string, Account>();
      // Only USD account, no GBP
      accountsByCurrency.set("USD", createMockAccount("USD"));

      const transaction = createFXTransaction("GBP.USD", -100, 1.26);

      const result = splitFXConversions([transaction], accountsByCurrency);

      expect(result.skippedConversions).toHaveLength(1);
      expect(result.skippedConversions[0].reason).toContain("Source account for GBP not found");
      expect(result.skippedConversions[0].sourceCurrency).toBe("GBP");
      expect(result.skippedConversions[0].targetCurrency).toBe("USD");
    });

    it("should skip FX conversion when target account is missing", () => {
      const accountsByCurrency = new Map<string, Account>();
      // Only GBP account, no USD
      accountsByCurrency.set("GBP", createMockAccount("GBP"));

      const transaction = createFXTransaction("GBP.USD", -100, 1.26);

      const result = splitFXConversions([transaction], accountsByCurrency);

      expect(result.skippedConversions).toHaveLength(1);
      expect(result.skippedConversions[0].reason).toContain("Target account for USD not found");
    });
  });

  describe("Successful FX splitting", () => {
    it("should split valid FX conversion into withdrawal and deposit", () => {
      const accountsByCurrency = new Map<string, Account>();
      accountsByCurrency.set("GBP", createMockAccount("GBP"));
      accountsByCurrency.set("USD", createMockAccount("USD"));

      const transaction = createFXTransaction("GBP.USD", -100, 1.26);

      const result = splitFXConversions([transaction], accountsByCurrency);

      expect(result.successfulSplits).toBe(1);
      expect(result.totalFXConversions).toBe(1);
      expect(result.transactions).toHaveLength(2);

      const withdrawal = result.transactions[0];
      const deposit = result.transactions[1];

      expect(withdrawal.activityType).toBe("WITHDRAWAL");
      expect(withdrawal.currency).toBe("GBP");
      expect(withdrawal.amount).toBe(100);
      expect(withdrawal.symbol).toBe("$CASH-GBP");

      expect(deposit.activityType).toBe("DEPOSIT");
      expect(deposit.currency).toBe("USD");
      expect(deposit.amount).toBeCloseTo(126, 0);
      expect(deposit.symbol).toBe("$CASH-USD");
    });

    it("should use amount fallback when unitPrice is missing", () => {
      const accountsByCurrency = new Map<string, Account>();
      accountsByCurrency.set("GBP", createMockAccount("GBP"));
      accountsByCurrency.set("USD", createMockAccount("USD"));

      const transaction: ActivityImport = {
        date: "2024-01-15",
        symbol: "GBP.USD",
        activityType: "BUY",
        quantity: -100,
        unitPrice: 0, // No unit price
        amount: 126, // Direct amount
        fee: 0,
        currency: "USD",
        accountId: "acc-1",
        isValid: true,
        isDraft: false,
      };

      const result = splitFXConversions([transaction], accountsByCurrency);

      expect(result.successfulSplits).toBe(1);
      const deposit = result.transactions[1];
      expect(deposit.amount).toBe(126);
    });

    it("should pass through non-FX transactions unchanged", () => {
      const accountsByCurrency = new Map<string, Account>();
      accountsByCurrency.set("USD", createMockAccount("USD"));

      const stockTrade: ActivityImport = {
        date: "2024-01-15",
        symbol: "AAPL",
        activityType: "BUY",
        quantity: 10,
        unitPrice: 150,
        amount: 1500,
        fee: 1,
        currency: "USD",
        accountId: "acc-1",
        isValid: true,
        isDraft: false,
      };

      const result = splitFXConversions([stockTrade], accountsByCurrency);

      expect(result.totalFXConversions).toBe(0);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]).toEqual(stockTrade);
    });

    it("should detect FX via comment when symbol has dot but not currency pattern", () => {
      const accountsByCurrency = new Map<string, Account>();
      accountsByCurrency.set("GBP", createMockAccount("GBP"));
      accountsByCurrency.set("USD", createMockAccount("USD"));

      // This has a dot but won't match XXX.YYY pattern, but comment triggers FX detection
      // However, since it doesn't have valid currency pair, it should be skipped
      const transaction: ActivityImport = {
        date: "2024-01-15",
        symbol: "GBP.TEST.USD",
        activityType: "BUY",
        quantity: -100,
        unitPrice: 1.26,
        amount: 126,
        fee: 0,
        currency: "USD",
        accountId: "acc-1",
        isValid: true,
        isDraft: false,
        comment: "forex trade",
      };

      const result = splitFXConversions([transaction], accountsByCurrency);

      expect(result.skippedConversions).toHaveLength(1);
    });
  });
});

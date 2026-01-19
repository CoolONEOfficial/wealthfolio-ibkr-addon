import { describe, it, expect, vi } from "vitest";
import {
  createActivityFingerprint,
  createExistingActivityFingerprint,
  filterDuplicateActivities,
  deduplicateActivities,
} from "../lib/activity-deduplicator";
import type { ActivityImport } from "@wealthfolio/addon-sdk";

describe("Activity Deduplicator", () => {
  describe("createActivityFingerprint", () => {
    it("should create consistent fingerprint for activity", () => {
      const activity: ActivityImport = {
        accountId: "acc1",
        date: "2024-01-15",
        symbol: "AAPL",
        activityType: "BUY",
        quantity: 10,
        unitPrice: 150.50,
        currency: "USD",
        fee: 1.00,
        amount: 1505.00,
        comment: "",
        isDraft: false,
        isValid: true,
      };

      const fingerprint = createActivityFingerprint(activity);
      // For BUY/SELL: fingerprint uses quantity + unitPrice (not amount)
      expect(fingerprint).toBe("2024-01-15|AAPL|BUY|10.000000|150.500000|1.000000|USD");
    });

    it("should normalize case in symbol and activity type", () => {
      // Using lowercase to test case normalization - cast needed since ActivityType is uppercase
      const activity1: ActivityImport = {
        accountId: "acc1",
        date: "2024-01-15",
        symbol: "aapl",
        activityType: "buy" as ActivityImport["activityType"],
        quantity: 10,
        unitPrice: 150.50,
        currency: "usd",
        fee: 1.00,
        amount: 1505.00,
        comment: "",
        isDraft: false,
        isValid: true,
      };

      const activity2: ActivityImport = {
        accountId: "acc1",
        date: "2024-01-15",
        symbol: "AAPL",
        activityType: "BUY",
        quantity: 10,
        unitPrice: 150.50,
        currency: "USD",
        fee: 1.00,
        amount: 1505.00,
        comment: "",
        isDraft: false,
        isValid: true,
      };

      expect(createActivityFingerprint(activity1)).toBe(createActivityFingerprint(activity2));
    });

    it("should handle ISO date format with time", () => {
      const activity: ActivityImport = {
        accountId: "acc1",
        date: "2024-01-15T10:30:00Z",
        symbol: "AAPL",
        activityType: "BUY",
        quantity: 10,
        unitPrice: 150.50,
        currency: "USD",
        fee: 1.00,
        amount: 1505.00,
        comment: "",
        isDraft: false,
        isValid: true,
      };

      const fingerprint = createActivityFingerprint(activity);
      expect(fingerprint).toContain("2024-01-15|");
    });

    it("should handle floating point precision", () => {
      const activity1: ActivityImport = {
        accountId: "acc1",
        date: "2024-01-15",
        symbol: "AAPL",
        activityType: "DIVIDEND",
        quantity: 100,
        unitPrice: 0.264,
        currency: "USD",
        fee: 0,
        amount: 26.4,
        comment: "",
        isDraft: false,
        isValid: true,
      };

      const activity2: ActivityImport = {
        accountId: "acc1",
        date: "2024-01-15",
        symbol: "AAPL",
        activityType: "DIVIDEND",
        quantity: 100,
        unitPrice: 0.2640000001, // Floating point variation
        currency: "USD",
        fee: 0,
        amount: 26.40000001,
        comment: "",
        isDraft: false,
        isValid: true,
      };

      expect(createActivityFingerprint(activity1)).toBe(createActivityFingerprint(activity2));
    });

    it("should handle undefined/null values gracefully", () => {
      const activity: any = {
        accountId: "acc1",
        date: "2024-01-15",
        symbol: "AAPL",
        activityType: "BUY",
        quantity: undefined,
        unitPrice: null,
        currency: "USD",
        fee: undefined,
        amount: undefined,
      };

      const fingerprint = createActivityFingerprint(activity);
      expect(fingerprint).toContain("0.000000");
    });

    it("should differentiate between different activity types", () => {
      const buyActivity: ActivityImport = {
        accountId: "acc1",
        date: "2024-01-15",
        symbol: "AAPL",
        activityType: "BUY",
        quantity: 10,
        unitPrice: 150.50,
        currency: "USD",
        fee: 1.00,
        amount: 1505.00,
        comment: "",
        isDraft: false,
        isValid: true,
      };

      const sellActivity: ActivityImport = {
        accountId: "acc1",
        date: "2024-01-15",
        symbol: "AAPL",
        activityType: "SELL",
        quantity: 10,
        unitPrice: 150.50,
        currency: "USD",
        fee: 1.00,
        amount: 1505.00,
        comment: "",
        isDraft: false,
        isValid: true,
      };

      expect(createActivityFingerprint(buyActivity)).not.toBe(createActivityFingerprint(sellActivity));
    });

    it("should differentiate between different dates", () => {
      const activity1: ActivityImport = {
        accountId: "acc1",
        date: "2024-01-15",
        symbol: "AAPL",
        activityType: "BUY",
        quantity: 10,
        unitPrice: 150.50,
        currency: "USD",
        fee: 1.00,
        amount: 1505.00,
        comment: "",
        isDraft: false,
        isValid: true,
      };

      const activity2: ActivityImport = {
        accountId: "acc1",
        date: "2024-01-16",
        symbol: "AAPL",
        activityType: "BUY",
        quantity: 10,
        unitPrice: 150.50,
        currency: "USD",
        fee: 1.00,
        amount: 1505.00,
        comment: "",
        isDraft: false,
        isValid: true,
      };

      expect(createActivityFingerprint(activity1)).not.toBe(createActivityFingerprint(activity2));
    });
  });

  describe("createExistingActivityFingerprint", () => {
    it("should create matching fingerprint for database activity", () => {
      const existingActivity = {
        activityDate: "2024-01-15",
        assetId: "AAPL",
        activityType: "BUY",
        quantity: 10,
        unitPrice: 150.50,
        currency: "USD",
        fee: 1.00,
        amount: 1505.00,
      };

      const newActivity: ActivityImport = {
        accountId: "acc1",
        date: "2024-01-15",
        symbol: "AAPL",
        activityType: "BUY",
        quantity: 10,
        unitPrice: 150.50,
        currency: "USD",
        fee: 1.00,
        amount: 1505.00,
        comment: "",
        isDraft: false,
        isValid: true,
      };

      expect(createExistingActivityFingerprint(existingActivity)).toBe(createActivityFingerprint(newActivity));
    });
  });

  describe("filterDuplicateActivities", () => {
    it("should filter out duplicate activities", () => {
      const existingActivities = [
        {
          activityDate: "2024-01-15",
          assetId: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-01-16",
          symbol: "MSFT",
          activityType: "BUY",
          quantity: 5,
          unitPrice: 380.00,
          currency: "USD",
          fee: 1.00,
          amount: 1900.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(duplicates.length).toBe(1);
      expect(duplicates[0].symbol).toBe("AAPL");
      expect(unique.length).toBe(1);
      expect(unique[0].symbol).toBe("MSFT");
    });

    it("should handle duplicates within the same import batch", () => {
      const existingActivities: any[] = [];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "Duplicate in batch",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(unique.length).toBe(1);
      expect(duplicates.length).toBe(1);
      expect(duplicates[0].comment).toBe("Duplicate in batch");
    });

    it("should return all activities when no duplicates exist", () => {
      const existingActivities: any[] = [];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-01-16",
          symbol: "MSFT",
          activityType: "BUY",
          quantity: 5,
          unitPrice: 380.00,
          currency: "USD",
          fee: 1.00,
          amount: 1900.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(unique.length).toBe(2);
      expect(duplicates.length).toBe(0);
    });

    it("should filter all activities when all are duplicates", () => {
      const existingActivities = [
        {
          activityDate: "2024-01-15",
          assetId: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
        },
        {
          activityDate: "2024-01-16",
          assetId: "MSFT",
          activityType: "BUY",
          quantity: 5,
          unitPrice: 380.00,
          currency: "USD",
          fee: 1.00,
          amount: 1900.00,
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-01-16",
          symbol: "MSFT",
          activityType: "BUY",
          quantity: 5,
          unitPrice: 380.00,
          currency: "USD",
          fee: 1.00,
          amount: 1900.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(unique.length).toBe(0);
      expect(duplicates.length).toBe(2);
    });

    it("should handle empty new activities array", () => {
      const existingActivities = [
        {
          activityDate: "2024-01-15",
          assetId: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
        },
      ];

      const newActivities: ActivityImport[] = [];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(unique.length).toBe(0);
      expect(duplicates.length).toBe(0);
    });
  });

  describe("deduplicateActivities", () => {
    it("should deduplicate activities by fetching existing ones", async () => {
      const existingActivities = [
        {
          activityDate: "2024-01-15",
          assetId: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
        },
      ];

      const mockGetExisting = vi.fn().mockResolvedValue(existingActivities);

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-01-16",
          symbol: "MSFT",
          activityType: "BUY",
          quantity: 5,
          unitPrice: 380.00,
          currency: "USD",
          fee: 1.00,
          amount: 1900.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const result = await deduplicateActivities(newActivities, "acc1", mockGetExisting);

      expect(mockGetExisting).toHaveBeenCalledWith("acc1");
      expect(result.toImport.length).toBe(1);
      expect(result.duplicatesSkipped).toBe(1);
      expect(result.toImport[0].symbol).toBe("MSFT");
    });

    it("should return empty array for empty input", async () => {
      const mockGetExisting = vi.fn().mockResolvedValue([]);

      const result = await deduplicateActivities([], "acc1", mockGetExisting);

      expect(mockGetExisting).not.toHaveBeenCalled();
      expect(result.toImport.length).toBe(0);
      expect(result.duplicatesSkipped).toBe(0);
    });
  });

  describe("Edge Cases for Deduplication", () => {
    it("should handle same-day multiple transactions with different quantities", () => {
      const existingActivities = [
        {
          activityDate: "2024-01-15",
          assetId: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 20, // Different quantity
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 3010.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(unique.length).toBe(1);
      expect(unique[0].quantity).toBe(20);
      expect(duplicates.length).toBe(1);
      expect(duplicates[0].quantity).toBe(10);
    });

    it("should handle dividend vs tax on same date for same symbol", () => {
      const existingActivities = [
        {
          activityDate: "2024-01-15",
          assetId: "AAPL",
          activityType: "DIVIDEND",
          quantity: 100,
          unitPrice: 0.24,
          currency: "USD",
          fee: 0,
          amount: 24.00,
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "DIVIDEND",
          quantity: 100,
          unitPrice: 0.24,
          currency: "USD",
          fee: 0,
          amount: 24.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "TAX",
          quantity: 100,
          unitPrice: 0.036,
          currency: "USD",
          fee: 0,
          amount: 3.60,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(unique.length).toBe(1);
      expect(unique[0].activityType).toBe("TAX");
      expect(duplicates.length).toBe(1);
      expect(duplicates[0].activityType).toBe("DIVIDEND");
    });

    it("should handle FX transfer pairs without duplicate", () => {
      const existingActivities = [
        {
          activityDate: "2024-01-15",
          assetId: "$CASH-USD",
          activityType: "TRANSFER_OUT",
          quantity: 1000,
          unitPrice: 1,
          currency: "USD",
          fee: 0,
          amount: 1000,
        },
        {
          activityDate: "2024-01-15",
          assetId: "$CASH-GBP",
          activityType: "TRANSFER_IN",
          quantity: 800,
          unitPrice: 1,
          currency: "GBP",
          fee: 0,
          amount: 800,
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc-usd",
          date: "2024-01-15",
          symbol: "$CASH-USD",
          activityType: "TRANSFER_OUT",
          quantity: 1000,
          unitPrice: 1,
          currency: "USD",
          fee: 0,
          amount: 1000,
          comment: "",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc-gbp",
          date: "2024-01-15",
          symbol: "$CASH-GBP",
          activityType: "TRANSFER_IN",
          quantity: 800,
          unitPrice: 1,
          currency: "GBP",
          fee: 0,
          amount: 800,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(unique.length).toBe(0);
      expect(duplicates.length).toBe(2);
    });

    it("should handle activities with very small fee differences (floating point)", () => {
      const existingActivities = [
        {
          activityDate: "2024-01-15",
          assetId: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.005,
          amount: 1505.00,
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.0050001, // Very small floating point difference
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      // Should be considered duplicate due to rounding
      expect(duplicates.length).toBe(1);
      expect(unique.length).toBe(0);
    });

    it("should not deduplicate activities from different currencies", () => {
      const existingActivities = [
        {
          activityDate: "2024-01-15",
          assetId: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "GBP", // Different currency
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(unique.length).toBe(1);
      expect(duplicates.length).toBe(0);
    });

    it("should handle cross-source deduplication (Flex Query then CSV)", () => {
      // Simulates: first import via Flex Query, second import via CSV
      const existingActivitiesFromFlexQuery = [
        {
          activityDate: "2024-01-15",
          assetId: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
        },
        {
          activityDate: "2024-01-16",
          assetId: "MSFT",
          activityType: "BUY",
          quantity: 5,
          unitPrice: 380.00,
          currency: "USD",
          fee: 1.00,
          amount: 1900.00,
        },
      ];

      // Same transactions from CSV upload
      const newActivitiesFromCSV: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "From CSV",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-01-16",
          symbol: "MSFT",
          activityType: "BUY",
          quantity: 5,
          unitPrice: 380.00,
          currency: "USD",
          fee: 1.00,
          amount: 1900.00,
          comment: "From CSV",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-01-17",
          symbol: "GOOGL",
          activityType: "BUY",
          quantity: 3,
          unitPrice: 140.00,
          currency: "USD",
          fee: 1.00,
          amount: 420.00,
          comment: "New from CSV",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(
        newActivitiesFromCSV,
        existingActivitiesFromFlexQuery
      );

      expect(duplicates.length).toBe(2);
      expect(unique.length).toBe(1);
      expect(unique[0].symbol).toBe("GOOGL");
    });

    it("should handle re-importing same CSV file twice", () => {
      const existingActivities = [
        {
          activityDate: "2024-01-15",
          assetId: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
        },
      ];

      // Same CSV imported twice (simulated)
      const sameCSVImportedAgain: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(sameCSVImportedAgain, existingActivities);

      expect(duplicates.length).toBe(1);
      expect(unique.length).toBe(0);
    });

    it("should handle multiple CSVs with overlapping data", () => {
      const existingActivities: any[] = [];

      // First CSV file
      const csv1Activities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-01-16",
          symbol: "MSFT",
          activityType: "BUY",
          quantity: 5,
          unitPrice: 380.00,
          currency: "USD",
          fee: 1.00,
          amount: 1900.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      // Second CSV file (overlapping with first)
      const csv2Activities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-16",
          symbol: "MSFT",
          activityType: "BUY",
          quantity: 5,
          unitPrice: 380.00,
          currency: "USD",
          fee: 1.00,
          amount: 1900.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-01-17",
          symbol: "GOOGL",
          activityType: "BUY",
          quantity: 3,
          unitPrice: 140.00,
          currency: "USD",
          fee: 1.00,
          amount: 420.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      // Combine both CSVs
      const combinedActivities = [...csv1Activities, ...csv2Activities];

      const { unique, duplicates } = filterDuplicateActivities(combinedActivities, existingActivities);

      // Should dedupe within the batch
      expect(unique.length).toBe(3); // AAPL, MSFT, GOOGL
      expect(duplicates.length).toBe(1); // One MSFT duplicate
    });
  });

  describe("Date Object Handling", () => {
    it("should handle Date objects from database vs string dates from import", () => {
      // Database returns Date objects, import has strings
      const existingActivities = [
        {
          activityDate: new Date("2024-01-15T10:30:00Z"), // Date object from DB
          assetId: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15", // String from import
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities as any);

      expect(duplicates.length).toBe(1);
      expect(unique.length).toBe(0);
    });

    it("should handle Date objects with different timezones", () => {
      const existingActivities = [
        {
          activityDate: new Date("2024-01-15T23:59:59Z"), // Late in the day UTC
          assetId: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15T00:00:00Z", // Early in the day
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities as any);

      // Should match because both normalize to 2024-01-15
      expect(duplicates.length).toBe(1);
      expect(unique.length).toBe(0);
    });
  });

  describe("Flex Query vs CSV Cross-Source Tests", () => {
    it("should deduplicate when Flex Query has slightly different timestamp format", () => {
      // Flex Query might return "2024-01-15" while CSV might have "2024-01-15T00:00:00"
      const existingFromFlexQuery = [
        {
          activityDate: "2024-01-15",
          assetId: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
        },
      ];

      const newFromCSV: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15T00:00:00Z",
          symbol: "AAPL",
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newFromCSV, existingFromFlexQuery);

      expect(duplicates.length).toBe(1);
      expect(unique.length).toBe(0);
    });

    it("should handle case sensitivity in symbol names across sources", () => {
      const existingActivities = [
        {
          activityDate: "2024-01-15",
          assetId: "aapl", // lowercase from one source
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "AAPL", // uppercase from another source
          activityType: "BUY",
          quantity: 10,
          unitPrice: 150.50,
          currency: "USD",
          fee: 1.00,
          amount: 1505.00,
          comment: "",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(duplicates.length).toBe(1);
      expect(unique.length).toBe(0);
    });
  });

  describe("Dividend Deduplication (Per-Share Rate Matching)", () => {
    it("should deduplicate identical dividends within a single CSV file", () => {
      // Scenario: Same dividend appears twice in one CSV file (data export error)
      const existingActivities: any[] = [];

      const activitiesFromSingleCSV: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-03-03",
          symbol: "F",
          activityType: "DIVIDEND",
          quantity: 100,
          unitPrice: 0.15,
          currency: "USD",
          fee: 0,
          amount: 15.00,
          comment: "F(US3453708600) Cash Dividend USD 0.15 per Share (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-03-03",
          symbol: "F",
          activityType: "DIVIDEND",
          quantity: 100,
          unitPrice: 0.15,
          currency: "USD",
          fee: 0,
          amount: 15.00,
          comment: "F(US3453708600) Cash Dividend USD 0.15 per Share (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(activitiesFromSingleCSV, existingActivities);

      expect(unique.length).toBe(1);
      expect(duplicates.length).toBe(1);
      expect(unique[0].symbol).toBe("F");
      expect(unique[0].amount).toBe(15.00);
    });

    it("should deduplicate dividends across two overlapping CSV files", () => {
      // Scenario: Same dividend appears in both plain1.csv and plain2.csv
      const existingActivities: any[] = [];

      // Combined activities from two CSV files with overlapping date ranges
      const combinedActivities: ActivityImport[] = [
        // From CSV1 (plain1.csv)
        {
          accountId: "acc1",
          date: "2025-03-03",
          symbol: "F",
          activityType: "DIVIDEND",
          quantity: 90,
          unitPrice: 0.15,
          currency: "USD",
          fee: 0,
          amount: 13.50,
          comment: "F(US3453708600) Cash Dividend USD 0.15 per Share (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
        // From CSV2 (plain2.csv) - same dividend
        {
          accountId: "acc1",
          date: "2025-03-03",
          symbol: "F",
          activityType: "DIVIDEND",
          quantity: 90,
          unitPrice: 0.15,
          currency: "USD",
          fee: 0,
          amount: 13.50,
          comment: "F(US3453708600) Cash Dividend USD 0.15 per Share (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
        // Unique dividend only in CSV2
        {
          accountId: "acc1",
          date: "2025-03-15",
          symbol: "O",
          activityType: "DIVIDEND",
          quantity: 150,
          unitPrice: 0.264,
          currency: "USD",
          fee: 0,
          amount: 39.60,
          comment: "O(US7561091049) Cash Dividend USD 0.264 per Share (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(combinedActivities, existingActivities);

      expect(unique.length).toBe(2); // F once, O once
      expect(duplicates.length).toBe(1); // Duplicate F
      expect(unique.map(u => u.symbol).sort()).toEqual(["F", "O"]);
    });

    it("should NOT deduplicate different dividends on same date for same symbol", () => {
      // Scenario: Some companies pay multiple dividends on same day (e.g., special + regular)
      const existingActivities: any[] = [];

      const activitiesWithMultipleDividends: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-12-15",
          symbol: "MSFT",
          activityType: "DIVIDEND",
          quantity: 50,
          unitPrice: 0.75,
          currency: "USD",
          fee: 0,
          amount: 37.50,
          comment: "MSFT(US5949181045) Cash Dividend USD 0.75 per Share (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-12-15",
          symbol: "MSFT",
          activityType: "DIVIDEND",
          quantity: 50,
          unitPrice: 0.10,
          currency: "USD",
          fee: 0,
          amount: 5.00,
          comment: "MSFT(US5949181045) Cash Dividend USD 0.10 per Share (Special Dividend)",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(activitiesWithMultipleDividends, existingActivities);

      // Both should be kept - different per-share rates
      expect(unique.length).toBe(2);
      expect(duplicates.length).toBe(0);
    });

    it("should deduplicate dividends using per-share rate even if amounts differ slightly", () => {
      // Scenario: Same dividend but calculated amounts differ due to position differences
      // This tests that per-share rate is used for matching, not total amount
      const existingActivities = [
        {
          activityDate: "2024-01-15",
          assetId: "O",
          activityType: "DIVIDEND",
          quantity: 100, // Backend might have different position
          unitPrice: 0.264,
          currency: "USD",
          fee: 0,
          amount: 26.40, // Backend calculated amount
          comment: "O(US7561091049) Cash Dividend USD 0.264 per Share (Ordinary Dividend)",
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-01-15",
          symbol: "O",
          activityType: "DIVIDEND",
          quantity: 150, // New import has different position
          unitPrice: 0.264,
          currency: "USD",
          fee: 0,
          amount: 39.60, // Different amount due to different position
          comment: "O(US7561091049) Cash Dividend USD 0.264 per Share (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      // Should be considered duplicate because same per-share rate (0.264)
      expect(duplicates.length).toBe(1);
      expect(unique.length).toBe(0);
    });

    it("should fallback to amount for dividends without per-share in comment", () => {
      // Scenario: HKD dividends often don't have "per Share" in description
      const existingActivities: any[] = [];

      const hkdDividends: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-05-10",
          symbol: "101",
          activityType: "DIVIDEND",
          quantity: 500,
          unitPrice: 0.40,
          currency: "HKD",
          fee: 0,
          amount: 200.00,
          comment: "101 (HK0101000591) Cash Dividend HKD 0.40 (Ordinary Dividend)", // No "per Share"
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-05-10",
          symbol: "101",
          activityType: "DIVIDEND",
          quantity: 500,
          unitPrice: 0.40,
          currency: "HKD",
          fee: 0,
          amount: 200.00,
          comment: "101 (HK0101000591) Cash Dividend HKD 0.40 (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(hkdDividends, existingActivities);

      // Should deduplicate using the extracted per-share rate (0.40)
      expect(unique.length).toBe(1);
      expect(duplicates.length).toBe(1);
    });

    it("should handle triple duplicate dividends in batch", () => {
      // Scenario: Same dividend appears 3 times (edge case)
      const existingActivities: any[] = [];

      const triplicateDividends: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2024-06-01",
          symbol: "AAPL",
          activityType: "DIVIDEND",
          quantity: 100,
          unitPrice: 0.24,
          currency: "USD",
          fee: 0,
          amount: 24.00,
          comment: "AAPL(US0378331005) Cash Dividend USD 0.24 per Share (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-06-01",
          symbol: "AAPL",
          activityType: "DIVIDEND",
          quantity: 100,
          unitPrice: 0.24,
          currency: "USD",
          fee: 0,
          amount: 24.00,
          comment: "AAPL(US0378331005) Cash Dividend USD 0.24 per Share (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-06-01",
          symbol: "AAPL",
          activityType: "DIVIDEND",
          quantity: 100,
          unitPrice: 0.24,
          currency: "USD",
          fee: 0,
          amount: 24.00,
          comment: "AAPL(US0378331005) Cash Dividend USD 0.24 per Share (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(triplicateDividends, existingActivities);

      expect(unique.length).toBe(1);
      expect(duplicates.length).toBe(2);
    });

    it("should deduplicate dividend with associated tax entry separately", () => {
      // Scenario: Dividend and its withholding tax should be handled independently
      const existingActivities: any[] = [];

      const dividendWithTax: ActivityImport[] = [
        // First occurrence
        {
          accountId: "acc1",
          date: "2024-03-15",
          symbol: "PBR",
          activityType: "DIVIDEND",
          quantity: 200,
          unitPrice: 0.50,
          currency: "USD",
          fee: 0,
          amount: 100.00,
          comment: "PBR(US71654V4086) Cash Dividend USD 0.50 per Share (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-03-15",
          symbol: "PBR",
          activityType: "TAX",
          quantity: 0,
          unitPrice: 0,
          currency: "USD",
          fee: 0,
          amount: 15.00,
          comment: "PBR - Withholding Tax",
          isDraft: false,
          isValid: true,
        },
        // Second occurrence (duplicate from overlapping CSV)
        {
          accountId: "acc1",
          date: "2024-03-15",
          symbol: "PBR",
          activityType: "DIVIDEND",
          quantity: 200,
          unitPrice: 0.50,
          currency: "USD",
          fee: 0,
          amount: 100.00,
          comment: "PBR(US71654V4086) Cash Dividend USD 0.50 per Share (Ordinary Dividend)",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2024-03-15",
          symbol: "PBR",
          activityType: "TAX",
          quantity: 0,
          unitPrice: 0,
          currency: "USD",
          fee: 0,
          amount: 15.00,
          comment: "PBR - Withholding Tax",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(dividendWithTax, existingActivities);

      expect(unique.length).toBe(2); // One dividend + one tax
      expect(duplicates.length).toBe(2); // Duplicate dividend + duplicate tax
    });
  });
});

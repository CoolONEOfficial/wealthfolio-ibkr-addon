/**
 * Integration test for CSV vs Flex Query deduplication
 *
 * This test simulates the real-world scenario where:
 * 1. User imports transactions via manual CSV upload
 * 2. User later imports via Flex Query API
 * 3. Duplicates should be detected and skipped
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseFlexQueryCSV } from "../lib/flex-csv-parser";
import { preprocessIBKRData } from "../lib/ibkr-preprocessor";
import { convertToActivityImports } from "../lib/activity-converter";
import {
  filterDuplicateActivities,
  createActivityFingerprint,
  createExistingActivityFingerprint,
} from "../lib/activity-deduplicator";
import type { ActivityImport } from "@wealthfolio/addon-sdk";

// Path to test CSV files
const CSV_DIR = path.join(__dirname, "../../../../ibkrtogetherisa");
const CSV1_PATH = path.join(CSV_DIR, "plain1.csv");
const CSV2_PATH = path.join(CSV_DIR, "plain2.csv");

/**
 * Simulates how the database stores activities
 * The backend stores quantity=0 and unitPrice=0 for cash transactions
 */
function simulateDatabaseStorage(activity: ActivityImport): {
  activityDate: string;
  assetId: string;
  activityType: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  fee: number;
  currency: string;
  comment?: string;
} {
  const isTrade = activity.activityType === "BUY" || activity.activityType === "SELL";

  return {
    activityDate: typeof activity.date === "string" ? activity.date : activity.date?.toISOString() || "",
    assetId: activity.symbol,
    activityType: activity.activityType,
    // Backend stores quantity and unitPrice as 0 for cash transactions
    quantity: isTrade ? (activity.quantity || 0) : 0,
    unitPrice: isTrade ? (activity.unitPrice || 0) : 0,
    amount: activity.amount || 0,
    fee: activity.fee || 0,
    currency: activity.currency || "",
    comment: activity.comment, // Include comment for dividend per-share fingerprinting
  };
}

describe("CSV vs Flex Query Deduplication Integration", () => {
  let csv1Content: string;
  let csv2Content: string;
  let csv1Available = false;
  let csv2Available = false;

  beforeAll(() => {
    // Try to load CSV files
    try {
      if (fs.existsSync(CSV1_PATH)) {
        csv1Content = fs.readFileSync(CSV1_PATH, "utf-8");
        csv1Available = true;
      }
    } catch (e) {
      console.log("plain1.csv not available for testing");
    }

    try {
      if (fs.existsSync(CSV2_PATH)) {
        csv2Content = fs.readFileSync(CSV2_PATH, "utf-8");
        csv2Available = true;
      }
    } catch (e) {
      console.log("plain2.csv not available for testing");
    }
  });

  describe("Manual CSV Import followed by same CSV Import", () => {
    it("should detect all duplicates when importing same CSV twice", async () => {
      if (!csv1Available) {
        console.log("Skipping test: plain1.csv not available");
        return;
      }

      // Parse CSV1
      const parsed1 = parseFlexQueryCSV(csv1Content);
      expect(parsed1.errors.length).toBe(0);

      // Preprocess
      const preprocessed1 = preprocessIBKRData(parsed1.rows);

      // Convert to activities
      const accountPreviews = [
        { currency: "GBP", name: "Test GBP", existingAccount: { id: "acc-gbp" } },
        { currency: "USD", name: "Test USD", existingAccount: { id: "acc-usd" } },
        { currency: "EUR", name: "Test EUR", existingAccount: { id: "acc-eur" } },
        { currency: "AUD", name: "Test AUD", existingAccount: { id: "acc-aud" } },
        { currency: "CHF", name: "Test CHF", existingAccount: { id: "acc-chf" } },
        { currency: "HKD", name: "Test HKD", existingAccount: { id: "acc-hkd" } },
        { currency: "NOK", name: "Test NOK", existingAccount: { id: "acc-nok" } },
      ];

      const activities1 = await convertToActivityImports(preprocessed1.processedData, accountPreviews as any);

      if (activities1.length === 0) {
        console.log("No activities parsed from CSV1, skipping test");
        return;
      }

      console.log(`First import: ${activities1.length} activities`);

      // Simulate database storage (first import)
      const storedActivities = activities1.map(simulateDatabaseStorage);

      // Second import of same CSV
      const parsed2 = parseFlexQueryCSV(csv1Content);
      const preprocessed2 = preprocessIBKRData(parsed2.rows);
      const activities2 = await convertToActivityImports(preprocessed2.processedData, accountPreviews as any);

      // Filter duplicates
      const { unique, duplicates } = filterDuplicateActivities(activities2, storedActivities);

      console.log(`Second import: ${activities2.length} activities`);
      console.log(`Duplicates detected: ${duplicates.length}`);
      console.log(`Unique (should be 0): ${unique.length}`);

      // All activities should be detected as duplicates
      expect(unique.length).toBe(0);
      expect(duplicates.length).toBe(activities2.length);
    });
  });

  describe("Two different CSVs followed by combined re-import", () => {
    it("should detect all duplicates when re-importing both CSVs", async () => {
      if (!csv1Available || !csv2Available) {
        console.log("Skipping test: CSV files not available");
        return;
      }

      const accountPreviews = [
        { currency: "GBP", name: "Test GBP", existingAccount: { id: "acc-gbp" } },
        { currency: "USD", name: "Test USD", existingAccount: { id: "acc-usd" } },
        { currency: "EUR", name: "Test EUR", existingAccount: { id: "acc-eur" } },
        { currency: "AUD", name: "Test AUD", existingAccount: { id: "acc-aud" } },
        { currency: "CHF", name: "Test CHF", existingAccount: { id: "acc-chf" } },
        { currency: "HKD", name: "Test HKD", existingAccount: { id: "acc-hkd" } },
        { currency: "NOK", name: "Test NOK", existingAccount: { id: "acc-nok" } },
      ];

      // First import: CSV1
      const parsed1 = parseFlexQueryCSV(csv1Content);
      const preprocessed1 = preprocessIBKRData(parsed1.rows);
      const activities1 = await convertToActivityImports(preprocessed1.processedData, accountPreviews as any);

      // Second import: CSV2
      const parsed2 = parseFlexQueryCSV(csv2Content);
      const preprocessed2 = preprocessIBKRData(parsed2.rows);
      const activities2 = await convertToActivityImports(preprocessed2.processedData, accountPreviews as any);

      // Combine both into "database"
      const allActivities = [...activities1, ...activities2];
      const storedActivities = allActivities.map(simulateDatabaseStorage);

      console.log(`First import (CSV1): ${activities1.length} activities`);
      console.log(`Second import (CSV2): ${activities2.length} activities`);
      console.log(`Total stored: ${storedActivities.length} activities`);

      // Third import: Re-import both CSVs (simulating Flex Query fetching same data)
      const activitiesReimport = [...activities1, ...activities2];

      // Filter duplicates
      const { unique, duplicates } = filterDuplicateActivities(activitiesReimport, storedActivities);

      console.log(`Re-import duplicates detected: ${duplicates.length}`);
      console.log(`Re-import unique (should be 0): ${unique.length}`);

      // All activities should be detected as duplicates
      expect(unique.length).toBe(0);
      expect(duplicates.length).toBe(activitiesReimport.length);
    });
  });

  describe("Fingerprint consistency between import and storage", () => {
    it("should produce matching fingerprints for BUY transactions", () => {
      const importActivity: ActivityImport = {
        accountId: "acc1",
        date: "2024-12-26",
        symbol: "BTI",
        activityType: "BUY",
        quantity: 2,
        unitPrice: 35.6676,
        amount: 71.3352,
        fee: 0.582933689,
        currency: "GBP",
        isDraft: false,
        isValid: true,
      };

      const storedActivity = simulateDatabaseStorage(importActivity);

      const importFingerprint = createActivityFingerprint(importActivity);
      const storedFingerprint = createExistingActivityFingerprint(storedActivity);

      console.log(`Import fingerprint: ${importFingerprint}`);
      console.log(`Stored fingerprint: ${storedFingerprint}`);

      expect(importFingerprint).toBe(storedFingerprint);
    });

    it("should produce matching fingerprints for DIVIDEND transactions", () => {
      const importActivity: ActivityImport = {
        accountId: "acc1",
        date: "2025-01-15",
        symbol: "O",
        activityType: "DIVIDEND",
        quantity: 0.792, // Calculated from amount
        unitPrice: 1,
        amount: 0.792,
        fee: 0,
        currency: "USD",
        isDraft: false,
        isValid: true,
      };

      const storedActivity = simulateDatabaseStorage(importActivity);

      // For DIVIDEND, backend stores quantity=0, unitPrice=0
      expect(storedActivity.quantity).toBe(0);
      expect(storedActivity.unitPrice).toBe(0);

      const importFingerprint = createActivityFingerprint(importActivity);
      const storedFingerprint = createExistingActivityFingerprint(storedActivity);

      console.log(`Import fingerprint (DIVIDEND): ${importFingerprint}`);
      console.log(`Stored fingerprint (DIVIDEND): ${storedFingerprint}`);

      expect(importFingerprint).toBe(storedFingerprint);
    });

    it("should produce matching fingerprints for TRANSFER_IN transactions", () => {
      const importActivity: ActivityImport = {
        accountId: "acc1",
        date: "2024-04-01",
        symbol: "$CASH-GBP",
        activityType: "TRANSFER_IN",
        quantity: 1, // Set to amount for cash transactions
        unitPrice: 1,
        amount: 1,
        fee: 0,
        currency: "GBP",
        isDraft: false,
        isValid: true,
      };

      const storedActivity = simulateDatabaseStorage(importActivity);

      // For TRANSFER_IN, backend stores quantity=0, unitPrice=0
      expect(storedActivity.quantity).toBe(0);
      expect(storedActivity.unitPrice).toBe(0);

      const importFingerprint = createActivityFingerprint(importActivity);
      const storedFingerprint = createExistingActivityFingerprint(storedActivity);

      console.log(`Import fingerprint (TRANSFER_IN): ${importFingerprint}`);
      console.log(`Stored fingerprint (TRANSFER_IN): ${storedFingerprint}`);

      expect(importFingerprint).toBe(storedFingerprint);
    });

    it("should produce matching fingerprints for TAX transactions", () => {
      const importActivity: ActivityImport = {
        accountId: "acc1",
        date: "2025-01-15",
        symbol: "O",
        activityType: "TAX",
        quantity: 0.1188,
        unitPrice: 1,
        amount: 0.1188,
        fee: 0,
        currency: "USD",
        isDraft: false,
        isValid: true,
      };

      const storedActivity = simulateDatabaseStorage(importActivity);

      const importFingerprint = createActivityFingerprint(importActivity);
      const storedFingerprint = createExistingActivityFingerprint(storedActivity);

      console.log(`Import fingerprint (TAX): ${importFingerprint}`);
      console.log(`Stored fingerprint (TAX): ${storedFingerprint}`);

      expect(importFingerprint).toBe(storedFingerprint);
    });

    it("should produce matching fingerprints for FEE transactions", () => {
      const importActivity: ActivityImport = {
        accountId: "acc1",
        date: "2024-06-04",
        symbol: "$CASH-GBP",
        activityType: "FEE",
        quantity: 0.0156616,
        unitPrice: 1,
        amount: 0.0156616,
        fee: 0,
        currency: "GBP",
        isDraft: false,
        isValid: true,
      };

      const storedActivity = simulateDatabaseStorage(importActivity);

      const importFingerprint = createActivityFingerprint(importActivity);
      const storedFingerprint = createExistingActivityFingerprint(storedActivity);

      console.log(`Import fingerprint (FEE): ${importFingerprint}`);
      console.log(`Stored fingerprint (FEE): ${storedFingerprint}`);

      expect(importFingerprint).toBe(storedFingerprint);
    });
  });

  describe("Edge cases in deduplication", () => {
    it("should handle multiple transactions on same day for same symbol", () => {
      // Two BUY transactions for BTI on same day with different quantities
      const existingActivities = [
        {
          activityDate: "2025-01-16",
          assetId: "BTI",
          activityType: "BUY",
          quantity: 2,
          unitPrice: 35.6676,
          amount: 71.3352,
          fee: 0.582933689,
          currency: "GBP",
        },
        {
          activityDate: "2025-01-16",
          assetId: "BTI",
          activityType: "BUY",
          quantity: 2,
          unitPrice: 35.668,
          amount: 71.336,
          fee: 0.234286652,
          currency: "GBP",
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2025-01-16",
          symbol: "BTI",
          activityType: "BUY",
          quantity: 2,
          unitPrice: 35.6676,
          amount: 71.3352,
          fee: 0.582933689,
          currency: "GBP",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2025-01-16",
          symbol: "BTI",
          activityType: "BUY",
          quantity: 2,
          unitPrice: 35.668,
          amount: 71.336,
          fee: 0.234286652,
          currency: "GBP",
          isDraft: false,
          isValid: true,
        },
        {
          accountId: "acc1",
          date: "2025-01-16",
          symbol: "BTI",
          activityType: "BUY",
          quantity: 3, // Different quantity - new transaction
          unitPrice: 35.67,
          amount: 107.01,
          fee: 0.5,
          currency: "GBP",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(duplicates.length).toBe(2);
      expect(unique.length).toBe(1);
      expect(unique[0].quantity).toBe(3);
    });

    it("should handle date format differences (ISO vs simple)", () => {
      const existingActivities = [
        {
          activityDate: "2025-01-15T00:00:00+00:00", // ISO format from database
          assetId: "O",
          activityType: "DIVIDEND",
          quantity: 0,
          unitPrice: 0,
          amount: 0.792,
          fee: 0,
          currency: "USD",
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2025-01-15", // Simple format from import
          symbol: "O",
          activityType: "DIVIDEND",
          quantity: 0.792,
          unitPrice: 1,
          amount: 0.792,
          fee: 0,
          currency: "USD",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(duplicates.length).toBe(1);
      expect(unique.length).toBe(0);
    });

    it("should handle floating point precision differences", () => {
      const existingActivities = [
        {
          activityDate: "2025-01-15",
          assetId: "O",
          activityType: "DIVIDEND",
          quantity: 0,
          unitPrice: 0,
          amount: 0.7920000001, // Floating point variation
          fee: 0,
          currency: "USD",
        },
      ];

      const newActivities: ActivityImport[] = [
        {
          accountId: "acc1",
          date: "2025-01-15",
          symbol: "O",
          activityType: "DIVIDEND",
          quantity: 0.792,
          unitPrice: 1,
          amount: 0.792,
          fee: 0,
          currency: "USD",
          isDraft: false,
          isValid: true,
        },
      ];

      const { unique, duplicates } = filterDuplicateActivities(newActivities, existingActivities);

      expect(duplicates.length).toBe(1);
      expect(unique.length).toBe(0);
    });
  });

  describe("Real-world scenario simulation", () => {
    it("should handle CSV import followed by Flex Query import", async () => {
      if (!csv1Available) {
        console.log("Skipping test: CSV files not available");
        return;
      }

      const accountPreviews = [
        { currency: "GBP", name: "Test GBP", existingAccount: { id: "acc-gbp" } },
        { currency: "USD", name: "Test USD", existingAccount: { id: "acc-usd" } },
        { currency: "EUR", name: "Test EUR", existingAccount: { id: "acc-eur" } },
        { currency: "AUD", name: "Test AUD", existingAccount: { id: "acc-aud" } },
        { currency: "CHF", name: "Test CHF", existingAccount: { id: "acc-chf" } },
        { currency: "HKD", name: "Test HKD", existingAccount: { id: "acc-hkd" } },
        { currency: "NOK", name: "Test NOK", existingAccount: { id: "acc-nok" } },
      ];

      // Step 1: Import CSV (simulating manual upload)
      const parsedCSV = parseFlexQueryCSV(csv1Content);
      const preprocessedCSV = preprocessIBKRData(parsedCSV.rows);
      const csvActivities = await convertToActivityImports(preprocessedCSV.processedData, accountPreviews as any);

      // Store in "database"
      const storedActivities = csvActivities.map(simulateDatabaseStorage);

      console.log(`\n=== Real-world scenario ===`);
      console.log(`CSV import: ${csvActivities.length} activities stored`);

      // Step 2: Flex Query import (same data, should all be duplicates)
      // In real scenario, Flex Query returns same transactions
      const flexQueryActivities = csvActivities; // Same data

      // Filter duplicates
      const { unique, duplicates } = filterDuplicateActivities(flexQueryActivities, storedActivities);

      console.log(`Flex Query import: ${flexQueryActivities.length} activities`);
      console.log(`Duplicates detected: ${duplicates.length}`);
      console.log(`New activities: ${unique.length}`);

      // All should be duplicates
      expect(unique.length).toBe(0);
      expect(duplicates.length).toBe(flexQueryActivities.length);
    });
  });

  describe("Fingerprint analysis for debugging", () => {
    it("should show fingerprint breakdown for mismatched activities", async () => {
      if (!csv1Available) {
        console.log("Skipping test: CSV files not available");
        return;
      }

      const accountPreviews = [
        { currency: "GBP", name: "Test GBP", existingAccount: { id: "acc-gbp" } },
        { currency: "USD", name: "Test USD", existingAccount: { id: "acc-usd" } },
      ];

      // Parse and convert
      const parsed = parseFlexQueryCSV(csv1Content);
      const preprocessed = preprocessIBKRData(parsed.rows);
      const activities = await convertToActivityImports(preprocessed.processedData, accountPreviews as any);

      if (activities.length === 0) {
        console.log("No activities to analyze");
        return;
      }

      console.log(`\n=== Fingerprint Analysis ===`);
      console.log(`Total activities: ${activities.length}`);

      // Group by activity type
      const byType = new Map<string, ActivityImport[]>();
      for (const activity of activities) {
        const type = activity.activityType;
        if (!byType.has(type)) {
          byType.set(type, []);
        }
        byType.get(type)!.push(activity);
      }

      for (const [type, typeActivities] of byType) {
        console.log(`\n${type}: ${typeActivities.length} activities`);

        // Show first activity of each type
        const sample = typeActivities[0];
        const stored = simulateDatabaseStorage(sample);

        console.log(`  Sample import: date=${sample.date}, symbol=${sample.symbol}, qty=${sample.quantity}, price=${sample.unitPrice}, amount=${sample.amount}`);
        console.log(`  After storage: date=${stored.activityDate}, symbol=${stored.assetId}, qty=${stored.quantity}, price=${stored.unitPrice}, amount=${stored.amount}`);

        const importFp = createActivityFingerprint(sample);
        const storedFp = createExistingActivityFingerprint(stored);

        console.log(`  Import fingerprint: ${importFp}`);
        console.log(`  Stored fingerprint: ${storedFp}`);
        console.log(`  Match: ${importFp === storedFp ? "YES" : "NO"}`);
      }
    });
  });
});

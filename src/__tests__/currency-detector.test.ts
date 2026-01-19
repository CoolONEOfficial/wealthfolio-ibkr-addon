import { describe, it, expect } from "vitest";
import { detectCurrenciesFromIBKR } from "../lib/currency-detector";
import type { CsvRowData } from "../presets/types";

describe("Currency Detector", () => {
  describe("detectCurrenciesFromIBKR", () => {
    it("should detect single currency from summary row", () => {
      const rows: CsvRowData[] = [
        { LevelOfDetail: "Currency", CurrencyPrimary: "USD", lineNumber: "1" },
      ];

      const currencies = detectCurrenciesFromIBKR(rows);

      expect(currencies).toEqual(["USD"]);
    });

    it("should detect multiple currencies from summary rows", () => {
      const rows: CsvRowData[] = [
        { LevelOfDetail: "Currency", CurrencyPrimary: "USD", lineNumber: "1" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "GBP", lineNumber: "2" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "EUR", lineNumber: "3" },
      ];

      const currencies = detectCurrenciesFromIBKR(rows);

      expect(currencies).toEqual(["EUR", "GBP", "USD"]); // Sorted alphabetically
    });

    it("should deduplicate currencies", () => {
      const rows: CsvRowData[] = [
        { LevelOfDetail: "Currency", CurrencyPrimary: "USD", lineNumber: "1" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "USD", lineNumber: "2" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "GBP", lineNumber: "3" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "GBP", lineNumber: "4" },
      ];

      const currencies = detectCurrenciesFromIBKR(rows);

      expect(currencies).toEqual(["GBP", "USD"]);
    });

    it("should only read from rows with LevelOfDetail = Currency", () => {
      const rows: CsvRowData[] = [
        // Summary rows (should be read)
        { LevelOfDetail: "Currency", CurrencyPrimary: "USD", lineNumber: "1" },
        // Transaction rows (should be ignored)
        { LevelOfDetail: "Detail", CurrencyPrimary: "EUR", lineNumber: "2" },
        { LevelOfDetail: "Summary", CurrencyPrimary: "GBP", lineNumber: "3" },
        { CurrencyPrimary: "CHF", lineNumber: "4" }, // No LevelOfDetail
      ];

      const currencies = detectCurrenciesFromIBKR(rows);

      expect(currencies).toEqual(["USD"]); // Only USD from Currency row
    });

    it("should return empty array for empty input", () => {
      const currencies = detectCurrenciesFromIBKR([]);

      expect(currencies).toEqual([]);
    });

    it("should return empty array when no Currency rows exist", () => {
      const rows: CsvRowData[] = [
        { LevelOfDetail: "Detail", CurrencyPrimary: "USD", lineNumber: "1" },
        { LevelOfDetail: "Summary", CurrencyPrimary: "EUR", lineNumber: "2" },
      ];

      const currencies = detectCurrenciesFromIBKR(rows);

      expect(currencies).toEqual([]);
    });

    it("should trim whitespace from currency codes", () => {
      const rows: CsvRowData[] = [
        { LevelOfDetail: "Currency", CurrencyPrimary: "  USD  ", lineNumber: "1" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "GBP ", lineNumber: "2" },
      ];

      const currencies = detectCurrenciesFromIBKR(rows);

      expect(currencies).toEqual(["GBP", "USD"]);
    });

    it("should skip rows with empty currency", () => {
      const rows: CsvRowData[] = [
        { LevelOfDetail: "Currency", CurrencyPrimary: "", lineNumber: "1" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "USD", lineNumber: "2" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "   ", lineNumber: "3" },
      ];

      const currencies = detectCurrenciesFromIBKR(rows);

      expect(currencies).toEqual(["USD"]);
    });

    it("should skip rows with undefined currency", () => {
      const rows: CsvRowData[] = [
        { LevelOfDetail: "Currency", lineNumber: "1" }, // CurrencyPrimary undefined
        { LevelOfDetail: "Currency", CurrencyPrimary: "USD", lineNumber: "2" },
      ];

      const currencies = detectCurrenciesFromIBKR(rows);

      expect(currencies).toEqual(["USD"]);
    });

    it("should skip rows where currency equals 'Currency' (header row)", () => {
      const rows: CsvRowData[] = [
        { LevelOfDetail: "Currency", CurrencyPrimary: "Currency", lineNumber: "1" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "USD", lineNumber: "2" },
      ];

      const currencies = detectCurrenciesFromIBKR(rows);

      expect(currencies).toEqual(["USD"]);
    });

    it("should handle real-world IBKR data structure", () => {
      const rows: CsvRowData[] = [
        // Header row
        { LevelOfDetail: "LevelOfDetail", CurrencyPrimary: "CurrencyPrimary", lineNumber: "1" },
        // Summary header
        { LevelOfDetail: "Header", CurrencyPrimary: "Base", lineNumber: "2" },
        // Currency summary rows (what we want)
        { LevelOfDetail: "Currency", CurrencyPrimary: "GBP", Symbol: "", lineNumber: "3" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "USD", Symbol: "", lineNumber: "4" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "EUR", Symbol: "", lineNumber: "5" },
        // Detail rows (transactions)
        { LevelOfDetail: "Detail", CurrencyPrimary: "GBP", Symbol: "AAPL", lineNumber: "6" },
        { LevelOfDetail: "Detail", CurrencyPrimary: "USD", Symbol: "MSFT", lineNumber: "7" },
      ];

      const currencies = detectCurrenciesFromIBKR(rows);

      expect(currencies).toEqual(["EUR", "GBP", "USD"]);
    });

    it("should sort currencies alphabetically", () => {
      const rows: CsvRowData[] = [
        { LevelOfDetail: "Currency", CurrencyPrimary: "ZAR", lineNumber: "1" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "AUD", lineNumber: "2" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "JPY", lineNumber: "3" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "GBP", lineNumber: "4" },
      ];

      const currencies = detectCurrenciesFromIBKR(rows);

      expect(currencies).toEqual(["AUD", "GBP", "JPY", "ZAR"]);
    });

    it("should handle many currencies", () => {
      const currencyCodes = ["USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "NZD", "HKD", "SGD"];
      const rows: CsvRowData[] = currencyCodes.map((code, index) => ({
        LevelOfDetail: "Currency",
        CurrencyPrimary: code,
        lineNumber: String(index + 1),
      }));

      const currencies = detectCurrenciesFromIBKR(rows);

      expect(currencies).toHaveLength(10);
      expect(currencies).toEqual([...currencyCodes].sort());
    });

    it("should handle case-sensitive currency codes", () => {
      const rows: CsvRowData[] = [
        { LevelOfDetail: "Currency", CurrencyPrimary: "USD", lineNumber: "1" },
        { LevelOfDetail: "Currency", CurrencyPrimary: "usd", lineNumber: "2" }, // lowercase
      ];

      const currencies = detectCurrenciesFromIBKR(rows);

      // Should treat USD and usd as different (case-sensitive)
      expect(currencies).toEqual(["USD", "usd"]);
    });
  });
});

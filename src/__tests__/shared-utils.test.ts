import { describe, it, expect } from "vitest";
import {
  CASH_SYMBOL_PREFIX,
  createCashSymbol,
  isCashSymbol,
  getCurrencyFromCashSymbol,
  getErrorMessage,
  formatDateToISO,
  validateCsvHeaders,
} from "../lib/shared-utils";

describe("Shared Utils", () => {
  describe("CASH_SYMBOL_PREFIX", () => {
    it("should be $CASH-", () => {
      expect(CASH_SYMBOL_PREFIX).toBe("$CASH-");
    });
  });

  describe("createCashSymbol", () => {
    it("should create USD cash symbol", () => {
      expect(createCashSymbol("USD")).toBe("$CASH-USD");
    });

    it("should create GBP cash symbol", () => {
      expect(createCashSymbol("GBP")).toBe("$CASH-GBP");
    });

    it("should create EUR cash symbol", () => {
      expect(createCashSymbol("EUR")).toBe("$CASH-EUR");
    });

    it("should handle lowercase currency", () => {
      expect(createCashSymbol("usd")).toBe("$CASH-usd");
    });

    it("should handle empty string", () => {
      expect(createCashSymbol("")).toBe("$CASH-");
    });
  });

  describe("isCashSymbol", () => {
    it("should return true for valid cash symbol", () => {
      expect(isCashSymbol("$CASH-USD")).toBe(true);
    });

    it("should return true for any cash symbol prefix", () => {
      expect(isCashSymbol("$CASH-GBP")).toBe(true);
      expect(isCashSymbol("$CASH-EUR")).toBe(true);
      expect(isCashSymbol("$CASH-JPY")).toBe(true);
    });

    it("should return true for $CASH- with anything after", () => {
      expect(isCashSymbol("$CASH-ANYTHING")).toBe(true);
    });

    it("should return false for regular stock symbol", () => {
      expect(isCashSymbol("AAPL")).toBe(false);
    });

    it("should return false for symbol starting with $", () => {
      expect(isCashSymbol("$AAPL")).toBe(false);
    });

    it("should return false for similar but wrong prefix", () => {
      expect(isCashSymbol("CASH-USD")).toBe(false);
    });

    it("should return false for null", () => {
      expect(isCashSymbol(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isCashSymbol(undefined)).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isCashSymbol("")).toBe(false);
    });
  });

  describe("getCurrencyFromCashSymbol", () => {
    it("should extract USD from cash symbol", () => {
      expect(getCurrencyFromCashSymbol("$CASH-USD")).toBe("USD");
    });

    it("should extract GBP from cash symbol", () => {
      expect(getCurrencyFromCashSymbol("$CASH-GBP")).toBe("GBP");
    });

    it("should extract EUR from cash symbol", () => {
      expect(getCurrencyFromCashSymbol("$CASH-EUR")).toBe("EUR");
    });

    it("should return empty string for $CASH- only", () => {
      expect(getCurrencyFromCashSymbol("$CASH-")).toBe("");
    });

    it("should return null for regular stock symbol", () => {
      expect(getCurrencyFromCashSymbol("AAPL")).toBeNull();
    });

    it("should return null for null input", () => {
      expect(getCurrencyFromCashSymbol(null)).toBeNull();
    });

    it("should return null for undefined input", () => {
      expect(getCurrencyFromCashSymbol(undefined)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(getCurrencyFromCashSymbol("")).toBeNull();
    });

    it("should return null for wrong prefix", () => {
      expect(getCurrencyFromCashSymbol("CASH-USD")).toBeNull();
    });
  });

  describe("getErrorMessage", () => {
    it("should extract message from Error object", () => {
      const error = new Error("Something went wrong");
      expect(getErrorMessage(error)).toBe("Something went wrong");
    });

    it("should return string as-is", () => {
      expect(getErrorMessage("Just a string")).toBe("Just a string");
    });

    it("should convert number to string", () => {
      expect(getErrorMessage(404)).toBe("404");
    });

    it("should convert object to string", () => {
      expect(getErrorMessage({ code: 500 })).toBe("[object Object]");
    });

    it("should handle null", () => {
      expect(getErrorMessage(null)).toBe("null");
    });

    it("should handle undefined", () => {
      expect(getErrorMessage(undefined)).toBe("undefined");
    });

    it("should handle TypeError", () => {
      const error = new TypeError("Type mismatch");
      expect(getErrorMessage(error)).toBe("Type mismatch");
    });

    it("should handle Error with empty message", () => {
      const error = new Error("");
      expect(getErrorMessage(error)).toBe("");
    });

    it("should handle array", () => {
      expect(getErrorMessage(["error1", "error2"])).toBe("error1,error2");
    });
  });

  describe("formatDateToISO", () => {
    it("should format Date object to ISO date", () => {
      const date = new Date("2024-03-15T10:30:00Z");
      expect(formatDateToISO(date)).toBe("2024-03-15");
    });

    it("should return string date as-is", () => {
      expect(formatDateToISO("2024-03-15")).toBe("2024-03-15");
    });

    it("should handle ISO string input", () => {
      expect(formatDateToISO("2024-03-15T10:30:00Z")).toBe("2024-03-15T10:30:00Z");
    });

    it("should return empty string for null", () => {
      expect(formatDateToISO(null)).toBe("");
    });

    it("should return empty string for undefined", () => {
      expect(formatDateToISO(undefined)).toBe("");
    });

    it("should handle Date at midnight UTC", () => {
      const date = new Date("2024-01-01T00:00:00Z");
      expect(formatDateToISO(date)).toBe("2024-01-01");
    });

    it("should handle Date at end of day UTC", () => {
      const date = new Date("2024-12-31T23:59:59Z");
      expect(formatDateToISO(date)).toBe("2024-12-31");
    });

    it("should handle leap year date", () => {
      const date = new Date("2024-02-29T12:00:00Z");
      expect(formatDateToISO(date)).toBe("2024-02-29");
    });
  });

  describe("validateCsvHeaders", () => {
    it("should return true for valid headers with 3+ columns", () => {
      expect(validateCsvHeaders(["Date", "Symbol", "Amount"])).toBe(true);
    });

    it("should return true for many columns", () => {
      expect(validateCsvHeaders(["A", "B", "C", "D", "E", "F"])).toBe(true);
    });

    it("should return false for too few columns", () => {
      expect(validateCsvHeaders(["Date", "Symbol"])).toBe(false);
    });

    it("should return false for single column", () => {
      expect(validateCsvHeaders(["Date"])).toBe(false);
    });

    it("should return false for empty array", () => {
      expect(validateCsvHeaders([])).toBe(false);
    });

    it("should return false for empty header in array", () => {
      expect(validateCsvHeaders(["Date", "", "Amount"])).toBe(false);
    });

    it("should return false for whitespace-only header", () => {
      expect(validateCsvHeaders(["Date", "   ", "Amount"])).toBe(false);
    });

    it("should return false for null header", () => {
      expect(validateCsvHeaders(["Date", null as unknown as string, "Amount"])).toBe(false);
    });

    it("should return false for undefined header", () => {
      expect(validateCsvHeaders(["Date", undefined as unknown as string, "Amount"])).toBe(false);
    });

    it("should handle headers with special characters", () => {
      expect(validateCsvHeaders(["Date/Time", "Buy/Sell", "Trade$"])).toBe(true);
    });

    it("should handle headers with numbers", () => {
      expect(validateCsvHeaders(["Col1", "Col2", "Col3"])).toBe(true);
    });

    it("should handle single character headers", () => {
      expect(validateCsvHeaders(["A", "B", "C"])).toBe(true);
    });

    describe("real-world CSV headers", () => {
      it("should validate IBKR trade headers", () => {
        const headers = [
          "ClientAccountID",
          "TransactionType",
          "Exchange",
          "Buy/Sell",
          "Symbol",
          "TradeDate",
          "TradeMoney",
        ];
        expect(validateCsvHeaders(headers)).toBe(true);
      });

      it("should validate IBKR dividend headers", () => {
        const headers = [
          "ClientAccountID",
          "Date/Time",
          "Amount",
          "Type",
          "Code",
          "Symbol",
        ];
        expect(validateCsvHeaders(headers)).toBe(true);
      });
    });
  });
});

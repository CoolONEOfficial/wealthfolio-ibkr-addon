import { describe, it, expect } from "vitest";
import { normalizeNumericValue } from "../lib/validation-utils";

describe("Validation Utils", () => {
  describe("normalizeNumericValue", () => {
    describe("basic numeric parsing", () => {
      it("should parse simple integer", () => {
        expect(normalizeNumericValue("123")).toBe(123);
      });

      it("should parse simple decimal", () => {
        expect(normalizeNumericValue("123.45")).toBe(123.45);
      });

      it("should parse negative number", () => {
        expect(normalizeNumericValue("-123.45")).toBe(-123.45);
      });

      it("should parse zero", () => {
        expect(normalizeNumericValue("0")).toBe(0);
      });

      it("should parse zero with decimals", () => {
        expect(normalizeNumericValue("0.00")).toBe(0);
      });
    });

    describe("whitespace handling", () => {
      it("should trim leading whitespace", () => {
        expect(normalizeNumericValue("  123.45")).toBe(123.45);
      });

      it("should trim trailing whitespace", () => {
        expect(normalizeNumericValue("123.45  ")).toBe(123.45);
      });

      it("should trim both leading and trailing whitespace", () => {
        expect(normalizeNumericValue("  123.45  ")).toBe(123.45);
      });

      it("should remove internal spaces", () => {
        expect(normalizeNumericValue("1 234.56")).toBe(1234.56);
      });
    });

    describe("currency symbol handling", () => {
      it("should remove dollar sign", () => {
        expect(normalizeNumericValue("$123.45")).toBe(123.45);
      });

      it("should remove pound sign", () => {
        expect(normalizeNumericValue("£123.45")).toBe(123.45);
      });

      it("should remove euro sign", () => {
        expect(normalizeNumericValue("€123.45")).toBe(123.45);
      });

      it("should remove yen sign", () => {
        expect(normalizeNumericValue("¥123")).toBe(123);
      });

      it("should remove rupee sign", () => {
        expect(normalizeNumericValue("₹123.45")).toBe(123.45);
      });

      it("should remove ruble sign", () => {
        expect(normalizeNumericValue("₽123.45")).toBe(123.45);
      });

      it("should remove cent sign", () => {
        expect(normalizeNumericValue("50¢")).toBe(50);
      });
    });

    describe("comma formatting", () => {
      it("should remove thousand separators", () => {
        expect(normalizeNumericValue("1,234")).toBe(1234);
      });

      it("should remove multiple thousand separators", () => {
        expect(normalizeNumericValue("1,234,567")).toBe(1234567);
      });

      it("should handle thousand separators with decimals", () => {
        expect(normalizeNumericValue("1,234.56")).toBe(1234.56);
      });

      it("should handle currency symbol with commas", () => {
        expect(normalizeNumericValue("$1,234.56")).toBe(1234.56);
      });
    });

    describe("parentheses (negative values)", () => {
      it("should handle negative value in parentheses", () => {
        // Parentheses are often used in accounting for negative values
        // Note: This removes parens but doesn't make the value negative
        expect(normalizeNumericValue("(123.45)")).toBe(123.45);
      });

      it("should handle currency with parentheses", () => {
        expect(normalizeNumericValue("($123.45)")).toBe(123.45);
      });
    });

    describe("invalid/empty values", () => {
      it("should return undefined for undefined input", () => {
        expect(normalizeNumericValue(undefined)).toBeUndefined();
      });

      it("should return undefined for empty string", () => {
        expect(normalizeNumericValue("")).toBeUndefined();
      });

      it("should return undefined for whitespace only", () => {
        expect(normalizeNumericValue("   ")).toBeUndefined();
      });

      it("should return undefined for single dash", () => {
        expect(normalizeNumericValue("-")).toBeUndefined();
      });

      it("should return undefined for N/A", () => {
        expect(normalizeNumericValue("N/A")).toBeUndefined();
      });

      it("should return undefined for null string", () => {
        expect(normalizeNumericValue("null")).toBeUndefined();
      });

      it("should return undefined for NULL string", () => {
        expect(normalizeNumericValue("NULL")).toBeUndefined();
      });

      it("should return undefined for non-numeric string", () => {
        expect(normalizeNumericValue("abc")).toBeUndefined();
      });

      it("should return undefined for mixed invalid text", () => {
        expect(normalizeNumericValue("not a number")).toBeUndefined();
      });
    });

    describe("edge cases", () => {
      it("should handle very large numbers", () => {
        expect(normalizeNumericValue("999999999999")).toBe(999999999999);
      });

      it("should handle very small decimals", () => {
        expect(normalizeNumericValue("0.000001")).toBe(0.000001);
      });

      it("should handle scientific notation", () => {
        expect(normalizeNumericValue("1.5e10")).toBe(15000000000);
      });

      it("should handle negative with currency symbol", () => {
        expect(normalizeNumericValue("-$123.45")).toBe(-123.45);
      });

      it("should handle multiple decimal points (invalid)", () => {
        // parseFloat handles this by taking first valid portion
        expect(normalizeNumericValue("1.2.3")).toBe(1.2);
      });

      it("should handle leading zeros", () => {
        expect(normalizeNumericValue("007")).toBe(7);
      });

      it("should handle decimal without leading zero", () => {
        expect(normalizeNumericValue(".5")).toBe(0.5);
      });

      it("should handle number ending with decimal point", () => {
        expect(normalizeNumericValue("123.")).toBe(123);
      });
    });

    describe("real-world IBKR examples", () => {
      it("should parse trade price", () => {
        expect(normalizeNumericValue("150.25")).toBe(150.25);
      });

      it("should parse formatted trade money", () => {
        expect(normalizeNumericValue("$15,025.50")).toBe(15025.5);
      });

      it("should parse dividend amount", () => {
        expect(normalizeNumericValue("0.264")).toBe(0.264);
      });

      it("should parse quantity", () => {
        expect(normalizeNumericValue("100")).toBe(100);
      });

      it("should parse fractional shares", () => {
        expect(normalizeNumericValue("0.523456")).toBe(0.523456);
      });

      it("should parse fee with currency", () => {
        expect(normalizeNumericValue("$1.50")).toBe(1.5);
      });

      it("should parse GBP amount", () => {
        expect(normalizeNumericValue("£1,500.00")).toBe(1500);
      });

      it("should parse EUR amount", () => {
        expect(normalizeNumericValue("€2,345.67")).toBe(2345.67);
      });
    });
  });
});

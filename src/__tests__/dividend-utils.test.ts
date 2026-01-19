import { describe, it, expect } from "vitest";
import { parseDividendInfo, extractDividendPerShare, DividendInfo } from "../lib/dividend-utils";

describe("Dividend Utils", () => {
  describe("parseDividendInfo", () => {
    describe("standard format with per Share", () => {
      it("should parse USD dividend", () => {
        const result = parseDividendInfo(
          "O(US7561091049) Cash Dividend USD 0.264 per Share (Ordinary Dividend)"
        );

        expect(result).toEqual({ currency: "USD", perShare: 0.264 });
      });

      it("should parse GBP dividend", () => {
        const result = parseDividendInfo(
          "SUPR(GB00BF345X11) Cash Dividend GBP 0.0153 per Share"
        );

        expect(result).toEqual({ currency: "GBP", perShare: 0.0153 });
      });

      it("should parse NOK dividend with multiple decimals", () => {
        const result = parseDividendInfo(
          "BAKKA(NO0010597883) Cash Dividend NOK 13.37347 per Share"
        );

        expect(result).toEqual({ currency: "NOK", perShare: 13.37347 });
      });

      it("should parse EUR dividend", () => {
        const result = parseDividendInfo(
          "Example Cash Dividend EUR 1.50 per Share"
        );

        expect(result).toEqual({ currency: "EUR", perShare: 1.5 });
      });

      it("should parse CHF dividend", () => {
        const result = parseDividendInfo(
          "NESN(CH0038863350) Cash Dividend CHF 3.00 per Share"
        );

        expect(result).toEqual({ currency: "CHF", perShare: 3.0 });
      });
    });

    describe("format without per Share", () => {
      it("should parse HKD dividend without per Share", () => {
        const result = parseDividendInfo(
          "101 (HK0101000591) Cash Dividend HKD 0.40 (Ordinary Dividend)"
        );

        expect(result).toEqual({ currency: "HKD", perShare: 0.4 });
      });

      it("should parse dividend ending with space", () => {
        const result = parseDividendInfo(
          "AAPL Cash Dividend USD 0.24 "
        );

        expect(result).toEqual({ currency: "USD", perShare: 0.24 });
      });

      it("should parse dividend at end of string", () => {
        const result = parseDividendInfo(
          "MSFT Cash Dividend USD 0.75"
        );

        expect(result).toEqual({ currency: "USD", perShare: 0.75 });
      });
    });

    describe("flexible format for edge cases", () => {
      it("should handle Special Dividend", () => {
        const result = parseDividendInfo(
          "XYZ Special Dividend USD 5.00 per Share"
        );

        expect(result).toEqual({ currency: "USD", perShare: 5.0 });
      });

      it("should handle Interim Dividend", () => {
        const result = parseDividendInfo(
          "ABC Interim Dividend GBP 0.125 per Share"
        );

        expect(result).toEqual({ currency: "GBP", perShare: 0.125 });
      });
    });

    describe("input normalization", () => {
      it("should normalize multiple spaces", () => {
        const result = parseDividendInfo(
          "Test  Cash   Dividend   USD   0.50   per   Share"
        );

        expect(result).toEqual({ currency: "USD", perShare: 0.5 });
      });

      it("should handle tabs", () => {
        const result = parseDividendInfo(
          "Test\tCash Dividend\tUSD\t0.50\tper Share"
        );

        expect(result).toEqual({ currency: "USD", perShare: 0.5 });
      });

      it("should trim whitespace", () => {
        const result = parseDividendInfo(
          "   Cash Dividend USD 0.50 per Share   "
        );

        expect(result).toEqual({ currency: "USD", perShare: 0.5 });
      });
    });

    describe("currency handling", () => {
      it("should normalize lowercase currency to uppercase", () => {
        const result = parseDividendInfo(
          "Cash Dividend usd 0.50 per Share"
        );

        expect(result).toEqual({ currency: "USD", perShare: 0.5 });
      });

      it("should normalize mixed case currency", () => {
        const result = parseDividendInfo(
          "Cash Dividend Usd 0.50 per Share"
        );

        expect(result).toEqual({ currency: "USD", perShare: 0.5 });
      });

      it("should handle 3-letter currency codes", () => {
        const result = parseDividendInfo(
          "Cash Dividend JPY 100 per Share"
        );

        expect(result).toEqual({ currency: "JPY", perShare: 100 });
      });

      it("should handle 4-letter currency codes (like USDT)", () => {
        const result = parseDividendInfo(
          "Cash Dividend USDT 1.00 per Share"
        );

        expect(result).toEqual({ currency: "USDT", perShare: 1.0 });
      });

      it("should handle 2-letter codes", () => {
        // Some older or special codes might be 2 letters
        const result = parseDividendInfo(
          "Cash Dividend HK 0.50 per Share"
        );

        expect(result).toEqual({ currency: "HK", perShare: 0.5 });
      });
    });

    describe("edge cases and error handling", () => {
      it("should return null for null input", () => {
        expect(parseDividendInfo(null)).toBeNull();
      });

      it("should return null for undefined input", () => {
        expect(parseDividendInfo(undefined)).toBeNull();
      });

      it("should return null for empty string", () => {
        expect(parseDividendInfo("")).toBeNull();
      });

      it("should return null for non-dividend description", () => {
        expect(parseDividendInfo("BUY 100 shares of AAPL")).toBeNull();
      });

      it("should return null for zero dividend amount", () => {
        expect(parseDividendInfo("Cash Dividend USD 0 per Share")).toBeNull();
      });

      it("should return null for negative dividend amount", () => {
        expect(parseDividendInfo("Cash Dividend USD -0.50 per Share")).toBeNull();
      });

      it("should return null for invalid number format", () => {
        expect(parseDividendInfo("Cash Dividend USD abc per Share")).toBeNull();
      });

      it("should return null for unreasonably large dividend", () => {
        // MAX_REASONABLE_DIVIDEND_PER_SHARE is 10000
        expect(parseDividendInfo("Cash Dividend USD 50000 per Share")).toBeNull();
      });

      it("should accept dividend at the limit (10000)", () => {
        const result = parseDividendInfo("Cash Dividend USD 10000 per Share");
        expect(result).toEqual({ currency: "USD", perShare: 10000 });
      });

      it("should return null for missing currency", () => {
        expect(parseDividendInfo("Cash Dividend 0.50 per Share")).toBeNull();
      });

      it("should return null for description without dividend keyword", () => {
        expect(parseDividendInfo("Cash Distribution USD 0.50 per Share")).toBeNull();
      });
    });

    describe("real-world examples", () => {
      it("should parse AAPL dividend", () => {
        const result = parseDividendInfo(
          "AAPL(US0378331005) Cash Dividend USD 0.24 per Share (Ordinary Dividend)"
        );
        expect(result).toEqual({ currency: "USD", perShare: 0.24 });
      });

      it("should parse HSBC dividend", () => {
        const result = parseDividendInfo(
          "HSBA(GB0005405286) Cash Dividend GBP 0.1 per Share"
        );
        expect(result).toEqual({ currency: "GBP", perShare: 0.1 });
      });

      it("should parse dividend with ISIN", () => {
        const result = parseDividendInfo(
          "VTI (US9229087690) Cash Dividend USD 0.8253 per Share"
        );
        expect(result).toEqual({ currency: "USD", perShare: 0.8253 });
      });
    });
  });

  describe("extractDividendPerShare", () => {
    it("should extract per-share rate from valid dividend", () => {
      const rate = extractDividendPerShare(
        "AAPL Cash Dividend USD 0.24 per Share"
      );
      expect(rate).toBe(0.24);
    });

    it("should return null for invalid input", () => {
      expect(extractDividendPerShare(null)).toBeNull();
      expect(extractDividendPerShare(undefined)).toBeNull();
      expect(extractDividendPerShare("")).toBeNull();
      expect(extractDividendPerShare("Not a dividend")).toBeNull();
    });

    it("should return null for invalid dividend format", () => {
      expect(extractDividendPerShare("Cash Dividend USD -1 per Share")).toBeNull();
    });

    it("should work with multiple decimal places", () => {
      const rate = extractDividendPerShare(
        "Cash Dividend NOK 13.37347 per Share"
      );
      expect(rate).toBe(13.37347);
    });
  });
});

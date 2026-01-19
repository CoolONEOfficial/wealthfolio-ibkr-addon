import { describe, it, expect } from "vitest";
import { getCurrencyForExchange, EXCHANGE_TO_CURRENCY } from "../lib/exchange-utils";

describe("Exchange Utils", () => {
  describe("EXCHANGE_TO_CURRENCY mapping", () => {
    it("should have mappings for US exchanges", () => {
      expect(EXCHANGE_TO_CURRENCY["NYSE"]).toBe("USD");
      expect(EXCHANGE_TO_CURRENCY["NASDAQ"]).toBe("USD");
      expect(EXCHANGE_TO_CURRENCY["AMEX"]).toBe("USD");
      expect(EXCHANGE_TO_CURRENCY["ARCA"]).toBe("USD");
      expect(EXCHANGE_TO_CURRENCY["BATS"]).toBe("USD");
      expect(EXCHANGE_TO_CURRENCY["IEX"]).toBe("USD");
      expect(EXCHANGE_TO_CURRENCY["CBOE"]).toBe("USD");
      expect(EXCHANGE_TO_CURRENCY["PINK"]).toBe("USD");
    });

    it("should have mappings for UK exchanges", () => {
      expect(EXCHANGE_TO_CURRENCY["LSE"]).toBe("GBP");
      expect(EXCHANGE_TO_CURRENCY["LSEIOB1"]).toBe("GBP");
    });

    it("should have mappings for European exchanges", () => {
      expect(EXCHANGE_TO_CURRENCY["EBS"]).toBe("CHF");
      expect(EXCHANGE_TO_CURRENCY["SBF"]).toBe("EUR");
      expect(EXCHANGE_TO_CURRENCY["AEB"]).toBe("EUR");
      expect(EXCHANGE_TO_CURRENCY["BVME"]).toBe("EUR");
      expect(EXCHANGE_TO_CURRENCY["FWB"]).toBe("EUR");
      expect(EXCHANGE_TO_CURRENCY["IBIS"]).toBe("EUR");
    });

    it("should have mappings for Asian exchanges", () => {
      expect(EXCHANGE_TO_CURRENCY["SEHK"]).toBe("HKD");
      expect(EXCHANGE_TO_CURRENCY["TSE"]).toBe("JPY");
      expect(EXCHANGE_TO_CURRENCY["SGX"]).toBe("SGD");
    });

    it("should have mappings for Australian exchange", () => {
      expect(EXCHANGE_TO_CURRENCY["ASX"]).toBe("AUD");
    });

    it("should have mappings for Scandinavian exchanges", () => {
      expect(EXCHANGE_TO_CURRENCY["OSE"]).toBe("NOK");
      expect(EXCHANGE_TO_CURRENCY["SFB"]).toBe("SEK");
      expect(EXCHANGE_TO_CURRENCY["KFB"]).toBe("DKK");
    });

    it("should have mappings for Canadian exchanges", () => {
      expect(EXCHANGE_TO_CURRENCY["TSX"]).toBe("CAD");
      expect(EXCHANGE_TO_CURRENCY["VENTURE"]).toBe("CAD");
    });

    it("should return undefined for unknown exchanges", () => {
      expect(EXCHANGE_TO_CURRENCY["UNKNOWN"]).toBeUndefined();
      expect(EXCHANGE_TO_CURRENCY["ABC"]).toBeUndefined();
      expect(EXCHANGE_TO_CURRENCY["123"]).toBeUndefined();
    });
  });

  describe("getCurrencyForExchange", () => {
    it("should return USD for US exchanges", () => {
      expect(getCurrencyForExchange("NYSE")).toBe("USD");
      expect(getCurrencyForExchange("NASDAQ")).toBe("USD");
      expect(getCurrencyForExchange("AMEX")).toBe("USD");
    });

    it("should return GBP for UK exchanges", () => {
      expect(getCurrencyForExchange("LSE")).toBe("GBP");
      expect(getCurrencyForExchange("LSEIOB1")).toBe("GBP");
    });

    it("should return EUR for European exchanges", () => {
      expect(getCurrencyForExchange("SBF")).toBe("EUR");
      expect(getCurrencyForExchange("AEB")).toBe("EUR");
      expect(getCurrencyForExchange("BVME")).toBe("EUR");
      expect(getCurrencyForExchange("FWB")).toBe("EUR");
    });

    it("should return CHF for Swiss exchange", () => {
      expect(getCurrencyForExchange("EBS")).toBe("CHF");
    });

    it("should return undefined for unknown exchange", () => {
      expect(getCurrencyForExchange("UNKNOWN")).toBeUndefined();
      expect(getCurrencyForExchange("XYZ")).toBeUndefined();
    });

    it("should return undefined for null input", () => {
      expect(getCurrencyForExchange(null)).toBeUndefined();
    });

    it("should return undefined for undefined input", () => {
      expect(getCurrencyForExchange(undefined)).toBeUndefined();
    });

    it("should return undefined for empty string", () => {
      expect(getCurrencyForExchange("")).toBeUndefined();
    });

    it("should trim whitespace from exchange code", () => {
      expect(getCurrencyForExchange("  NYSE  ")).toBe("USD");
      expect(getCurrencyForExchange("LSE ")).toBe("GBP");
      expect(getCurrencyForExchange(" NASDAQ")).toBe("USD");
    });

    it("should be case-sensitive", () => {
      // Exchange codes are uppercase in IBKR
      expect(getCurrencyForExchange("nyse")).toBeUndefined();
      expect(getCurrencyForExchange("Nasdaq")).toBeUndefined();
      expect(getCurrencyForExchange("lse")).toBeUndefined();
    });

    it("should handle all mapped exchanges", () => {
      // Test every exchange in the mapping
      for (const [exchange, currency] of Object.entries(EXCHANGE_TO_CURRENCY)) {
        expect(getCurrencyForExchange(exchange)).toBe(currency);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle PINK exchange for ADRs", () => {
      // PINK is used for OTC/ADR stocks like HESAY
      expect(getCurrencyForExchange("PINK")).toBe("USD");
    });

    it("should handle IBIS (Xetra) exchange", () => {
      // IBIS is another name for Xetra
      expect(getCurrencyForExchange("IBIS")).toBe("EUR");
    });

    it("should handle Hong Kong exchange", () => {
      expect(getCurrencyForExchange("SEHK")).toBe("HKD");
    });

    it("should handle VENTURE (TSX Venture)", () => {
      expect(getCurrencyForExchange("VENTURE")).toBe("CAD");
    });
  });
});

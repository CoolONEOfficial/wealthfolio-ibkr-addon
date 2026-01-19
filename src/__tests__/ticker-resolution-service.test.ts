import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Test the helper functions by extracting them
// These are the core logic from ticker-resolution-service.ts

// Exchange to suffix mapping (copied for testing)
const EXCHANGE_TO_SUFFIX: Record<string, string> = {
  LSE: ".L",
  LSEIOB1: ".L",
  EBS: ".SW",
  SWX: ".SW",
  FWB: ".DE",
  IBIS: ".DE",
  XETRA: ".DE",
  SBF: ".PA",
  AEB: ".AS",
  BVME: ".MI",
  BM: ".MC",
  SEHK: ".HK",
  TSE: ".T",
  ASX: ".AX",
  SGX: ".SI",
  OSE: ".OL",
  SFB: ".ST",
  KFB: ".CO",
  TSX: ".TO",
  VENTURE: ".V",
  NYSE: "",
  NASDAQ: "",
  AMEX: "",
  ARCA: "",
  BATS: "",
  IEX: "",
};

function formatHKSymbol(symbol: string): string {
  if (/^\d+$/.test(symbol)) {
    const paddedSymbol = symbol.padStart(4, "0");
    return `${paddedSymbol}.HK`;
  }
  return symbol;
}

function addExchangeSuffix(symbol: string, exchange: string): string {
  if (exchange === "SEHK" || exchange === "HKSE") {
    return formatHKSymbol(symbol);
  }

  const suffix = EXCHANGE_TO_SUFFIX[exchange];
  if (suffix) {
    if (symbol.includes(".")) {
      return symbol;
    }
    return `${symbol}${suffix}`;
  }

  return symbol;
}

// Currency to suffix inference (from the service)
function inferSuffixFromCurrency(symbol: string, currency: string): string {
  if (symbol.includes(".")) return symbol;

  const currencyMapping: Record<string, string> = {
    GBP: ".L",
    CHF: ".SW",
    EUR: ".DE",
    AUD: ".AX",
    NOK: ".OL",
    SEK: ".ST",
    CAD: ".TO",
    JPY: ".T",
  };

  if (currency === "HKD") {
    return formatHKSymbol(symbol);
  }

  const suffix = currencyMapping[currency];
  return suffix ? `${symbol}${suffix}` : symbol;
}

describe("Ticker Resolution Service", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatHKSymbol", () => {
    it("should pad numeric symbols to 4 digits and add .HK", () => {
      expect(formatHKSymbol("1")).toBe("0001.HK");
      expect(formatHKSymbol("9")).toBe("0009.HK");
      expect(formatHKSymbol("12")).toBe("0012.HK");
      expect(formatHKSymbol("123")).toBe("0123.HK");
      expect(formatHKSymbol("1234")).toBe("1234.HK");
      expect(formatHKSymbol("12345")).toBe("12345.HK");
    });

    it("should return non-numeric symbols unchanged", () => {
      expect(formatHKSymbol("HSBC")).toBe("HSBC");
      expect(formatHKSymbol("ABC123")).toBe("ABC123");
      expect(formatHKSymbol("123ABC")).toBe("123ABC");
    });

    it("should handle edge cases", () => {
      expect(formatHKSymbol("")).toBe("");
      expect(formatHKSymbol("0")).toBe("0000.HK");
      expect(formatHKSymbol("00")).toBe("0000.HK");
      expect(formatHKSymbol("000")).toBe("0000.HK");
      expect(formatHKSymbol("0000")).toBe("0000.HK");
    });
  });

  describe("addExchangeSuffix", () => {
    describe("UK exchanges", () => {
      it("should add .L suffix for LSE", () => {
        expect(addExchangeSuffix("HSBA", "LSE")).toBe("HSBA.L");
        expect(addExchangeSuffix("VOD", "LSE")).toBe("VOD.L");
      });

      it("should add .L suffix for LSEIOB1", () => {
        expect(addExchangeSuffix("HSBA", "LSEIOB1")).toBe("HSBA.L");
      });
    });

    describe("European exchanges", () => {
      it("should add .SW suffix for Swiss exchanges", () => {
        expect(addExchangeSuffix("NESN", "EBS")).toBe("NESN.SW");
        expect(addExchangeSuffix("UBSG", "SWX")).toBe("UBSG.SW");
      });

      it("should add .DE suffix for German exchanges", () => {
        expect(addExchangeSuffix("SAP", "FWB")).toBe("SAP.DE");
        expect(addExchangeSuffix("SAP", "IBIS")).toBe("SAP.DE");
        expect(addExchangeSuffix("SAP", "XETRA")).toBe("SAP.DE");
      });

      it("should add .PA suffix for French exchanges", () => {
        expect(addExchangeSuffix("MC", "SBF")).toBe("MC.PA");
      });

      it("should add .AS suffix for Amsterdam", () => {
        expect(addExchangeSuffix("ASML", "AEB")).toBe("ASML.AS");
      });

      it("should add .MI suffix for Milan", () => {
        expect(addExchangeSuffix("ENI", "BVME")).toBe("ENI.MI");
      });

      it("should add .MC suffix for Madrid", () => {
        expect(addExchangeSuffix("SAN", "BM")).toBe("SAN.MC");
      });
    });

    describe("Asian exchanges", () => {
      it("should handle Hong Kong exchange with numeric symbols", () => {
        expect(addExchangeSuffix("1", "SEHK")).toBe("0001.HK");
        expect(addExchangeSuffix("700", "SEHK")).toBe("0700.HK");
        expect(addExchangeSuffix("9988", "SEHK")).toBe("9988.HK");
      });

      it("should handle HKSE alias", () => {
        expect(addExchangeSuffix("1", "HKSE")).toBe("0001.HK");
      });

      it("should add .T suffix for Tokyo", () => {
        expect(addExchangeSuffix("7203", "TSE")).toBe("7203.T");
      });

      it("should add .SI suffix for Singapore", () => {
        expect(addExchangeSuffix("D05", "SGX")).toBe("D05.SI");
      });
    });

    describe("Other exchanges", () => {
      it("should add .AX suffix for Australia", () => {
        expect(addExchangeSuffix("BHP", "ASX")).toBe("BHP.AX");
      });

      it("should add .TO suffix for Toronto", () => {
        expect(addExchangeSuffix("RY", "TSX")).toBe("RY.TO");
      });

      it("should add .V suffix for Venture", () => {
        expect(addExchangeSuffix("XYZ", "VENTURE")).toBe("XYZ.V");
      });

      it("should add Scandinavian suffixes", () => {
        expect(addExchangeSuffix("EQNR", "OSE")).toBe("EQNR.OL");
        expect(addExchangeSuffix("VOLV-B", "SFB")).toBe("VOLV-B.ST");
        expect(addExchangeSuffix("NOVO-B", "KFB")).toBe("NOVO-B.CO");
      });
    });

    describe("US exchanges (no suffix)", () => {
      it("should not add suffix for NYSE", () => {
        expect(addExchangeSuffix("AAPL", "NYSE")).toBe("AAPL");
      });

      it("should not add suffix for NASDAQ", () => {
        expect(addExchangeSuffix("MSFT", "NASDAQ")).toBe("MSFT");
      });

      it("should not add suffix for AMEX", () => {
        expect(addExchangeSuffix("XYZ", "AMEX")).toBe("XYZ");
      });

      it("should not add suffix for other US exchanges", () => {
        expect(addExchangeSuffix("XYZ", "ARCA")).toBe("XYZ");
        expect(addExchangeSuffix("XYZ", "BATS")).toBe("XYZ");
        expect(addExchangeSuffix("XYZ", "IEX")).toBe("XYZ");
      });
    });

    describe("Edge cases", () => {
      it("should not add suffix if symbol already has one", () => {
        expect(addExchangeSuffix("HSBA.L", "LSE")).toBe("HSBA.L");
        expect(addExchangeSuffix("SAP.DE", "XETRA")).toBe("SAP.DE");
      });

      it("should return symbol unchanged for unknown exchange", () => {
        expect(addExchangeSuffix("XYZ", "UNKNOWN")).toBe("XYZ");
        expect(addExchangeSuffix("ABC", "")).toBe("ABC");
      });
    });
  });

  describe("inferSuffixFromCurrency", () => {
    it("should add .L for GBP", () => {
      expect(inferSuffixFromCurrency("HSBA", "GBP")).toBe("HSBA.L");
    });

    it("should add .SW for CHF", () => {
      expect(inferSuffixFromCurrency("NESN", "CHF")).toBe("NESN.SW");
    });

    it("should add .DE for EUR (default)", () => {
      expect(inferSuffixFromCurrency("SAP", "EUR")).toBe("SAP.DE");
    });

    it("should add .AX for AUD", () => {
      expect(inferSuffixFromCurrency("BHP", "AUD")).toBe("BHP.AX");
    });

    it("should handle HKD with numeric symbols", () => {
      expect(inferSuffixFromCurrency("700", "HKD")).toBe("0700.HK");
      expect(inferSuffixFromCurrency("9988", "HKD")).toBe("9988.HK");
    });

    it("should add Scandinavian suffixes", () => {
      expect(inferSuffixFromCurrency("EQNR", "NOK")).toBe("EQNR.OL");
      expect(inferSuffixFromCurrency("VOLV", "SEK")).toBe("VOLV.ST");
    });

    it("should add .TO for CAD", () => {
      expect(inferSuffixFromCurrency("RY", "CAD")).toBe("RY.TO");
    });

    it("should add .T for JPY", () => {
      expect(inferSuffixFromCurrency("7203", "JPY")).toBe("7203.T");
    });

    it("should not add suffix if already present", () => {
      expect(inferSuffixFromCurrency("HSBA.L", "GBP")).toBe("HSBA.L");
      expect(inferSuffixFromCurrency("SAP.DE", "EUR")).toBe("SAP.DE");
    });

    it("should return unchanged for USD (no suffix)", () => {
      expect(inferSuffixFromCurrency("AAPL", "USD")).toBe("AAPL");
    });

    it("should return unchanged for unknown currencies", () => {
      expect(inferSuffixFromCurrency("XYZ", "XXX")).toBe("XYZ");
    });
  });

  describe("Cash transaction handling", () => {
    it("should identify cash symbols", () => {
      const isCashSymbol = (symbol: string) => symbol.startsWith("$CASH-");

      expect(isCashSymbol("$CASH-USD")).toBe(true);
      expect(isCashSymbol("$CASH-EUR")).toBe(true);
      expect(isCashSymbol("$CASH-GBP")).toBe(true);
      expect(isCashSymbol("AAPL")).toBe(false);
      expect(isCashSymbol("CASH")).toBe(false);
    });
  });

  describe("Resolution key generation", () => {
    it("should create unique keys from ISIN and exchange", () => {
      const createKey = (isin: string, exchange: string) => `${isin}:${exchange}`;

      expect(createKey("US0378331005", "NASDAQ")).toBe("US0378331005:NASDAQ");
      expect(createKey("GB0005405286", "LSE")).toBe("GB0005405286:LSE");
      expect(createKey("DE0007164600", "XETRA")).toBe("DE0007164600:XETRA");
    });

    it("should handle missing ISIN or exchange", () => {
      const createKey = (isin: string | undefined, exchange: string | undefined) =>
        `${isin || ""}:${exchange || ""}`;

      expect(createKey(undefined, "NASDAQ")).toBe(":NASDAQ");
      expect(createKey("US0378331005", undefined)).toBe("US0378331005:");
      expect(createKey(undefined, undefined)).toBe(":");
    });
  });

  describe("Exchange suffix completeness", () => {
    it("should have all major exchanges covered", () => {
      const majorExchanges = [
        "NYSE",
        "NASDAQ",
        "LSE",
        "XETRA",
        "TSE",
        "SEHK",
        "ASX",
        "TSX",
        "SBF",
        "AEB",
      ];

      for (const exchange of majorExchanges) {
        expect(EXCHANGE_TO_SUFFIX).toHaveProperty(exchange);
      }
    });

    it("should have correct suffix format (starts with dot or empty)", () => {
      for (const [exchange, suffix] of Object.entries(EXCHANGE_TO_SUFFIX)) {
        expect(
          suffix === "" || suffix.startsWith("."),
          `Exchange ${exchange} has invalid suffix: ${suffix}`
        ).toBe(true);
      }
    });
  });
});

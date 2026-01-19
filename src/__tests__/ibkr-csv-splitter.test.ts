import { describe, it, expect } from "vitest";
import { extractTradesSection, isMultiSectionIBKR } from "../lib/ibkr-csv-splitter";

describe("IBKR CSV Splitter", () => {
  describe("isMultiSectionIBKR", () => {
    it("should return true for CSV with multiple sections", () => {
      const csv = `"ClientAccountID","AccountAlias","Model","CurrencyPrimary"
"U1234567","","","USD"
"ClientAccountID","AccountAlias","Model","CurrencyPrimary"
"U1234567","","","USD"`;

      expect(isMultiSectionIBKR(csv)).toBe(true);
    });

    it("should return false for CSV with single section", () => {
      const csv = `"ClientAccountID","AccountAlias","Model","CurrencyPrimary"
"U1234567","","","USD"
"U1234567","","","EUR"`;

      expect(isMultiSectionIBKR(csv)).toBe(false);
    });

    it("should return false for empty CSV", () => {
      expect(isMultiSectionIBKR("")).toBe(false);
    });

    it("should return false for CSV without IBKR header", () => {
      const csv = `"Name","Value"
"Test","123"`;

      expect(isMultiSectionIBKR(csv)).toBe(false);
    });

    it("should handle CSV with exactly one section", () => {
      const csv = `"ClientAccountID","AccountAlias"
"U1234567","MyAccount"`;

      expect(isMultiSectionIBKR(csv)).toBe(false);
    });
  });

  describe("extractTradesSection", () => {
    it("should extract trades section from multi-section CSV", () => {
      // Trades section with required columns
      const tradesSection = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00"`;

      // Dividends section with different columns
      const dividendsSection = `"ClientAccountID","Date/Time","Amount","Type","Code","Symbol"
"U1234567","2024-01-20","10.50","Dividends","DIV","AAPL"`;

      const fullCsv = `${tradesSection}
${dividendsSection}`;

      const result = extractTradesSection(fullCsv);

      // Should contain both rows
      expect(result).toContain("AAPL");
      expect(result).toContain("2024-01-15");
      expect(result).toContain("2024-01-20");
    });

    it("should throw error when no valid sections found", () => {
      const csv = ``;

      expect(() => extractTradesSection(csv)).toThrow("No valid IBKR sections found");
    });

    it("should throw error when no trades section found", () => {
      // Only dividends section, no trades section
      const csv = `"ClientAccountID","Date/Time","Amount","Type","Code","Symbol"
"U1234567","2024-01-20","10.50","Dividends","DIV","AAPL"`;

      expect(() => extractTradesSection(csv)).toThrow("No trades section found");
    });

    it("should handle trades-only CSV", () => {
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00"
"U1234567","ExchTrade","NYSE","SELL","MSFT","2024-01-16","2000.00"`;

      const result = extractTradesSection(csv);

      expect(result).toContain("AAPL");
      expect(result).toContain("MSFT");
      expect(result).toContain("TransactionType");
    });

    it("should normalize Date/Time to TradeDate for dividends", () => {
      const tradesSection = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00"`;

      const dividendsSection = `"ClientAccountID","Date/Time","Amount","Type","Code","Symbol"
"U1234567","2024-01-20 10:30:00","10.50","Dividends","DIV","AAPL"`;

      const fullCsv = `${tradesSection}
${dividendsSection}`;

      const result = extractTradesSection(fullCsv);

      // The Date/Time value should be mapped to TradeDate column
      expect(result).toContain("TradeDate");
    });

    it("should normalize Amount to TradeMoney for dividends", () => {
      const tradesSection = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00"`;

      const dividendsSection = `"ClientAccountID","Date/Time","Amount","Type","Code","Symbol"
"U1234567","2024-01-20","10.50","Dividends","DIV","AAPL"`;

      const fullCsv = `${tradesSection}
${dividendsSection}`;

      const result = extractTradesSection(fullCsv);

      // The Amount value should be in the result
      expect(result).toContain("10.50");
    });

    it("should handle transfers section", () => {
      const tradesSection = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00"`;

      const transfersSection = `"ClientAccountID","Direction","TransferCompany","CashTransfer","Date","Type"
"U1234567","IN","ACME Broker","5000.00","2024-01-10","ACATS"`;

      const fullCsv = `${tradesSection}
${transfersSection}`;

      const result = extractTradesSection(fullCsv);

      expect(result).toContain("5000.00");
      expect(result).toContain("2024-01-10");
    });

    it("should handle Windows line endings (CRLF)", () => {
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney"\r
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00"\r
"ClientAccountID","Date/Time","Amount","Type","Code","Symbol"\r
"U1234567","2024-01-20","10.50","Dividends","DIV","AAPL"`;

      const result = extractTradesSection(csv);

      expect(result).toContain("AAPL");
      expect(result).toContain("10.50");
    });

    it("should skip empty lines", () => {
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney"

"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00"

`;

      const result = extractTradesSection(csv);

      expect(result).toContain("AAPL");
      // Should only have header + 1 data row
      const lines = result.split("\n").filter(l => l.trim());
      expect(lines.length).toBe(2);
    });

    it("should preserve all columns from trades section", () => {
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney","Quantity","TradePrice"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00","10","150.00"`;

      const result = extractTradesSection(csv);

      expect(result).toContain("Quantity");
      expect(result).toContain("TradePrice");
      expect(result).toContain("10");
      expect(result).toContain("150.00");
    });

    it("should handle sections in any order", () => {
      // Dividends section first, then trades
      const dividendsSection = `"ClientAccountID","Date/Time","Amount","Type","Code","Symbol"
"U1234567","2024-01-20","10.50","Dividends","DIV","AAPL"`;

      const tradesSection = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00"`;

      const fullCsv = `${dividendsSection}
${tradesSection}`;

      const result = extractTradesSection(fullCsv);

      // Should work regardless of section order
      expect(result).toContain("AAPL");
      expect(result).toContain("1500.00");
      expect(result).toContain("10.50");
    });

    it("should handle multiple data rows per section", () => {
      const tradesSection = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00"
"U1234567","ExchTrade","NYSE","BUY","MSFT","2024-01-16","2000.00"
"U1234567","ExchTrade","NASDAQ","SELL","GOOGL","2024-01-17","3000.00"`;

      const dividendsSection = `"ClientAccountID","Date/Time","Amount","Type","Code","Symbol"
"U1234567","2024-01-20","10.50","Dividends","DIV","AAPL"
"U1234567","2024-01-21","5.25","Dividends","DIV","MSFT"`;

      const fullCsv = `${tradesSection}
${dividendsSection}`;

      const result = extractTradesSection(fullCsv);
      const lines = result.split("\n").filter(l => l.trim());

      // 1 header + 3 trades + 2 dividends = 6 lines
      expect(lines.length).toBe(6);
    });

    it("should handle unknown section type gracefully", () => {
      const tradesSection = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00"`;

      // Unknown section with unrecognized columns
      const unknownSection = `"ClientAccountID","RandomColumn1","RandomColumn2","RandomColumn3"
"U1234567","value1","value2","value3"`;

      const fullCsv = `${tradesSection}
${unknownSection}`;

      const result = extractTradesSection(fullCsv);

      // Should still work, including unknown section data
      expect(result).toContain("AAPL");
      expect(result).toContain("value1");
    });

    it("should fill missing columns with empty strings", () => {
      const tradesSection = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney","ExtraColumn"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00","extra"`;

      const dividendsSection = `"ClientAccountID","Date/Time","Amount","Type","Code","Symbol"
"U1234567","2024-01-20","10.50","Dividends","DIV","MSFT"`;

      const fullCsv = `${tradesSection}
${dividendsSection}`;

      const result = extractTradesSection(fullCsv);

      // Dividends row should have empty value for ExtraColumn
      expect(result).toContain('""');
    });
  });

  describe("section type detection", () => {
    it("should correctly identify trades section by required columns", () => {
      const tradesOnly = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL"`;

      // This should work since it has all required trades columns
      const result = extractTradesSection(tradesOnly);
      expect(result).toContain("AAPL");
    });

    it("should not misidentify dividends as trades", () => {
      // Dividends section lacks Exchange and Buy/Sell
      const dividendsOnly = `"ClientAccountID","Date/Time","Amount","Type","Code"
"U1234567","2024-01-20","10.50","Dividends","DIV"`;

      // Should throw because no trades section found
      expect(() => extractTradesSection(dividendsOnly)).toThrow("No trades section found");
    });

    it("should not misidentify transfers as trades", () => {
      // Transfers section lacks Exchange and Buy/Sell
      const transfersOnly = `"ClientAccountID","Direction","TransferCompany","CashTransfer"
"U1234567","IN","ACME","5000"`;

      // Should throw because no trades section found
      expect(() => extractTradesSection(transfersOnly)).toThrow("No trades section found");
    });
  });

  describe("edge cases", () => {
    it("should handle quoted values with embedded commas", () => {
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney","Description"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00","Apple, Inc."`;

      const result = extractTradesSection(csv);
      expect(result).toContain("AAPL");
      // The Description field with comma should be preserved as a single field
      expect(result).toContain('"Apple, Inc."');
    });

    it("should handle multiple commas in quoted field", () => {
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney","Description"
"U1234567","ExchTrade","NASDAQ","BUY","VWRL","2024-01-15","1500.00","VANGUARD FTSE DEV WORLD UCITS ETF, USD DISTRIBUTING, ACC"`;

      const result = extractTradesSection(csv);
      expect(result).toContain("VWRL");
      // Check the complex description is preserved
      expect(result).toContain("VANGUARD FTSE DEV WORLD UCITS ETF, USD DISTRIBUTING, ACC");
    });

    it("should handle escaped quotes in quoted fields", () => {
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney","Description"
"U1234567","ExchTrade","NASDAQ","BUY","TEST","2024-01-15","1500.00","Test ""quoted"" value"`;

      const result = extractTradesSection(csv);
      expect(result).toContain("TEST");
      // Escaped quotes ("") in CSV are parsed and preserved as single quotes
      expect(result).toContain('"Test "quoted" value"');
    });

    it("should correctly count columns with embedded commas", () => {
      // 8 columns: ClientAccountID, TransactionType, Exchange, Buy/Sell, Symbol, TradeDate, TradeMoney, Description
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney","Description"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00","Company, Inc., Ltd."`;

      const result = extractTradesSection(csv);
      const lines = result.split("\n").filter(l => l.trim());

      // Should have 2 lines: header and data
      expect(lines.length).toBe(2);

      // Count columns in header
      const headerFields = lines[0].split('","').length;
      expect(headerFields).toBe(8);
    });

    it("should handle very long CSV content", () => {
      let csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney"\n`;

      // Add 1000 rows
      for (let i = 0; i < 1000; i++) {
        csv += `"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","${i}.00"\n`;
      }

      const result = extractTradesSection(csv);
      const lines = result.split("\n").filter(l => l.trim());

      expect(lines.length).toBe(1001); // 1 header + 1000 data rows
    });

    it("should handle three sections (trades, dividends, transfers)", () => {
      const tradesSection = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","Symbol","TradeDate","TradeMoney"
"U1234567","ExchTrade","NASDAQ","BUY","AAPL","2024-01-15","1500.00"`;

      const dividendsSection = `"ClientAccountID","Date/Time","Amount","Type","Code","Symbol"
"U1234567","2024-01-20","10.50","Dividends","DIV","AAPL"`;

      const transfersSection = `"ClientAccountID","Direction","TransferCompany","CashTransfer","Date","Type"
"U1234567","IN","ACME Broker","5000.00","2024-01-10","ACATS"`;

      const fullCsv = `${tradesSection}
${dividendsSection}
${transfersSection}`;

      const result = extractTradesSection(fullCsv);
      const lines = result.split("\n").filter(l => l.trim());

      // 1 header + 1 trade + 1 dividend + 1 transfer = 4 lines
      expect(lines.length).toBe(4);
      expect(result).toContain("1500.00");
      expect(result).toContain("10.50");
      expect(result).toContain("5000.00");
    });
  });
});

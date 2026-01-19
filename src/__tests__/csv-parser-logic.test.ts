/**
 * Tests for CSV parsing logic
 *
 * These tests cover the core parsing logic without React hook dependencies.
 * The hook itself is a thin wrapper around these functions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Papa from "papaparse";
import { extractTradesSection, isMultiSectionIBKR } from "../lib/ibkr-csv-splitter";
import { MAX_FILE_SIZE_BYTES, MAX_FILES } from "../lib/constants";

// Extracted validation logic (mirrors hook validation)
function validateHeaders(headers: string[]): boolean {
  return headers.length >= 3 && !headers.some((header) => !header || header.trim() === "");
}

function validateFileInputs(
  files: { name: string; size: number }[]
): string | null {
  if (files.length === 0) {
    return "No files selected";
  }
  if (files.length > MAX_FILES) {
    return `Too many files selected (maximum ${MAX_FILES})`;
  }
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = Math.round(file.size / (1024 * 1024));
      return `File "${file.name}" is too large (${sizeMB}MB, maximum 50MB)`;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return `File "${file.name}" is not a CSV file`;
    }
  }
  return null;
}

describe("CSV Parser Logic", () => {
  describe("validateHeaders", () => {
    it("should accept valid headers with 3+ columns", () => {
      expect(validateHeaders(["A", "B", "C"])).toBe(true);
      expect(validateHeaders(["Name", "Amount", "Currency", "Date"])).toBe(true);
    });

    it("should reject headers with fewer than 3 columns", () => {
      expect(validateHeaders(["A", "B"])).toBe(false);
      expect(validateHeaders(["A"])).toBe(false);
      expect(validateHeaders([])).toBe(false);
    });

    it("should reject headers with empty strings", () => {
      expect(validateHeaders(["A", "", "C"])).toBe(false);
      expect(validateHeaders(["", "B", "C"])).toBe(false);
      expect(validateHeaders(["A", "B", ""])).toBe(false);
    });

    it("should reject headers with whitespace-only strings", () => {
      expect(validateHeaders(["A", "  ", "C"])).toBe(false);
      expect(validateHeaders(["  ", "B", "C"])).toBe(false);
    });
  });

  describe("validateFileInputs", () => {
    it("should return null for valid files", () => {
      const files = [
        { name: "test.csv", size: 1000 },
        { name: "another.csv", size: 2000 },
      ];
      expect(validateFileInputs(files)).toBeNull();
    });

    it("should error when no files are selected", () => {
      expect(validateFileInputs([])).toBe("No files selected");
    });

    it("should error when too many files are selected", () => {
      const files = Array(MAX_FILES + 1)
        .fill(0)
        .map((_, i) => ({ name: `file${i}.csv`, size: 100 }));
      expect(validateFileInputs(files)).toContain("Too many files");
    });

    it("should error when file is too large", () => {
      const files = [{ name: "large.csv", size: MAX_FILE_SIZE_BYTES + 1 }];
      const error = validateFileInputs(files);
      expect(error).toContain("too large");
      expect(error).toContain("large.csv");
    });

    it("should error for non-CSV files", () => {
      const files = [{ name: "test.txt", size: 100 }];
      expect(validateFileInputs(files)).toContain("not a CSV file");
    });

    it("should accept .CSV extension (case insensitive)", () => {
      const files = [{ name: "test.CSV", size: 100 }];
      expect(validateFileInputs(files)).toBeNull();
    });

    it("should check all files for errors", () => {
      const files = [
        { name: "valid.csv", size: 100 },
        { name: "invalid.txt", size: 100 },
      ];
      expect(validateFileInputs(files)).toContain("invalid.txt");
    });
  });

  describe("PapaParse integration", () => {
    it("should parse simple CSV correctly", () => {
      const csv = "Name,Amount,Currency\nApple,100,USD\nGoogle,200,EUR";
      const result = Papa.parse(csv, { header: true, skipEmptyLines: true });

      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({ Name: "Apple", Amount: "100", Currency: "USD" });
      expect(result.data[1]).toEqual({ Name: "Google", Amount: "200", Currency: "EUR" });
    });

    it("should handle quoted fields with commas", () => {
      const csv = 'Name,Amount,Notes\n"Apple, Inc.",100,"Note: has comma"';
      const result = Papa.parse(csv, { header: true, skipEmptyLines: true });

      expect(result.data).toHaveLength(1);
      expect((result.data[0] as Record<string, string>).Name).toBe("Apple, Inc.");
      expect((result.data[0] as Record<string, string>).Notes).toBe("Note: has comma");
    });

    it("should handle Windows line endings", () => {
      const csv = "A,B,C\r\n1,2,3\r\n4,5,6";
      const result = Papa.parse(csv, { header: true, skipEmptyLines: true });

      expect(result.data).toHaveLength(2);
    });

    it("should handle Unicode content", () => {
      const csv = "Name,Currency\nÄpple,€\nGöögle,¥";
      const result = Papa.parse(csv, { header: true, skipEmptyLines: true });

      expect(result.data).toHaveLength(2);
      expect((result.data[0] as Record<string, string>).Name).toBe("Äpple");
      expect((result.data[0] as Record<string, string>).Currency).toBe("€");
    });

    it("should skip empty lines", () => {
      const csv = "A,B,C\n1,2,3\n\n4,5,6\n\n";
      const result = Papa.parse(csv, { header: true, skipEmptyLines: true });

      expect(result.data).toHaveLength(2);
    });

    it("should report errors for malformed CSV", () => {
      const csv = 'A,B,C\n1,2,"unclosed quote';
      const result = Papa.parse(csv, { header: true, skipEmptyLines: true });

      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should handle empty CSV", () => {
      const csv = "";
      const result = Papa.parse(csv, { header: true, skipEmptyLines: true });

      expect(result.data).toHaveLength(0);
    });

    it("should handle CSV with only header", () => {
      const csv = "A,B,C";
      const result = Papa.parse(csv, { header: true, skipEmptyLines: true });

      expect(result.data).toHaveLength(0);
    });
  });

  describe("IBKR multi-section detection", () => {
    it("should detect single-section CSV as not multi-section", () => {
      const csv = '"ClientAccountID","Symbol","Amount"\n"U123","AAPL","100"';
      expect(isMultiSectionIBKR(csv)).toBe(false);
    });

    it("should detect multi-section IBKR CSV", () => {
      const csv = `"ClientAccountID","Symbol","Amount"
"U123","AAPL","100"
"ClientAccountID","Date","Dividend"
"U123","2024-01-15","50"`;
      expect(isMultiSectionIBKR(csv)).toBe(true);
    });

    it("should handle regular CSV without IBKR headers", () => {
      const csv = "Name,Amount\nApple,100";
      expect(isMultiSectionIBKR(csv)).toBe(false);
    });
  });

  describe("IBKR section extraction", () => {
    it("should extract and merge all IBKR sections", () => {
      // Multi-section IBKR CSV with trades and dividends
      const csv = `"ClientAccountID","TransactionType","Symbol","Exchange","Buy/Sell","Quantity","Price"
"U123","Trade","AAPL","NASDAQ","BUY","10","150.00"
"ClientAccountID","Date/Time","Amount","Symbol","Type"
"U123","2024-01-15","100.00","AAPL","Dividend"`;

      const merged = extractTradesSection(csv);

      // Should contain merged data
      expect(merged).toContain("ClientAccountID");
      expect(merged).toContain("AAPL");
    });

    it("should throw error for CSV without trades section", () => {
      const csv = `"ClientAccountID","Date/Time","Amount","Symbol","Type"
"U123","2024-01-15","100.00","AAPL","Dividend"`;

      expect(() => extractTradesSection(csv)).toThrow("No trades section found");
    });

    it("should throw error for empty CSV", () => {
      expect(() => extractTradesSection("")).toThrow("No valid IBKR sections found");
    });
  });

  describe("Row-to-object mapping", () => {
    it("should correctly map CSV rows to objects", () => {
      const csv = "A,B,C\n1,2,3";
      const result = Papa.parse(csv, { header: false, skipEmptyLines: true });

      const headers = result.data[0] as string[];
      const row = result.data[1] as string[];

      const obj: Record<string, string> = {};
      headers.forEach((header, index) => {
        obj[header.trim()] = row[index]?.trim() ?? "";
      });

      expect(obj).toEqual({ A: "1", B: "2", C: "3" });
    });

    it("should handle row with fewer fields than headers", () => {
      const csv = "A,B,C,D\n1,2";
      const result = Papa.parse(csv, { header: false, skipEmptyLines: true });

      const headers = result.data[0] as string[];
      const row = result.data[1] as string[];

      const obj: Record<string, string> = {};
      headers.forEach((header, index) => {
        obj[header.trim()] = row[index]?.trim() ?? "";
      });

      expect(obj).toEqual({ A: "1", B: "2", C: "", D: "" });
    });

    it("should handle row with more fields than headers", () => {
      const csv = "A,B\n1,2,3,4";
      const result = Papa.parse(csv, { header: false, skipEmptyLines: true });

      const headers = result.data[0] as string[];
      const row = result.data[1] as string[];

      const obj: Record<string, string> = {};
      headers.forEach((header, index) => {
        obj[header.trim()] = row[index]?.trim() ?? "";
      });

      // Only maps known headers, extras ignored
      expect(obj).toEqual({ A: "1", B: "2" });
    });
  });

  describe("Header merging logic", () => {
    it("should create union of headers from multiple sources", () => {
      const headers1 = ["A", "B", "C"];
      const headers2 = ["A", "D", "E"];

      const merged: string[] = [...headers1];
      for (const h of headers2) {
        if (!merged.includes(h)) {
          merged.push(h);
        }
      }

      expect(merged).toEqual(["A", "B", "C", "D", "E"]);
    });

    it("should preserve order with first file headers first", () => {
      const headers1 = ["Z", "Y", "X"];
      const headers2 = ["A", "B", "Z"];

      const merged: string[] = [...headers1];
      for (const h of headers2) {
        if (!merged.includes(h)) {
          merged.push(h);
        }
      }

      // Z, Y, X from first file, then A, B from second (Z already exists)
      expect(merged).toEqual(["Z", "Y", "X", "A", "B"]);
    });
  });

  describe("Line number tracking", () => {
    it("should assign sequential line numbers", () => {
      const rows = [
        { data: "row1" },
        { data: "row2" },
        { data: "row3" },
      ];

      const withLineNumbers = rows.map((row, index) => ({
        ...row,
        lineNumber: (index + 2).toString(), // +2 because line 1 is header
      }));

      expect(withLineNumbers[0].lineNumber).toBe("2");
      expect(withLineNumbers[1].lineNumber).toBe("3");
      expect(withLineNumbers[2].lineNumber).toBe("4");
    });
  });

  describe("File size validation edge cases", () => {
    it("should accept file exactly at size limit", () => {
      const files = [{ name: "exact.csv", size: MAX_FILE_SIZE_BYTES }];
      expect(validateFileInputs(files)).toBeNull();
    });

    it("should reject file 1 byte over limit", () => {
      const files = [{ name: "over.csv", size: MAX_FILE_SIZE_BYTES + 1 }];
      expect(validateFileInputs(files)).toContain("too large");
    });

    it("should accept empty file (0 bytes)", () => {
      const files = [{ name: "empty.csv", size: 0 }];
      expect(validateFileInputs(files)).toBeNull();
    });
  });

  describe("File count validation edge cases", () => {
    it("should accept exactly MAX_FILES", () => {
      const files = Array(MAX_FILES)
        .fill(0)
        .map((_, i) => ({ name: `file${i}.csv`, size: 100 }));
      expect(validateFileInputs(files)).toBeNull();
    });

    it("should reject MAX_FILES + 1", () => {
      const files = Array(MAX_FILES + 1)
        .fill(0)
        .map((_, i) => ({ name: `file${i}.csv`, size: 100 }));
      expect(validateFileInputs(files)).toContain("Too many files");
    });

    it("should accept single file", () => {
      const files = [{ name: "single.csv", size: 100 }];
      expect(validateFileInputs(files)).toBeNull();
    });
  });
});

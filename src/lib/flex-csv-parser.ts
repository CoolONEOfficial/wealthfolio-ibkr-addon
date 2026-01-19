/**
 * IBKR Flex Query CSV Parser
 *
 * Parses Flex Query CSV response and converts to CsvRowData format
 * for reuse of existing preprocessing and conversion logic.
 *
 * This parser reuses the same logic as the manual CSV import:
 * - extractTradesSection for multi-section IBKR CSVs
 * - PapaParse for CSV parsing
 */

import Papa, { ParseResult } from "papaparse";
import { CsvRowData } from "../presets/types";
import { extractTradesSection, isMultiSectionIBKR } from "./ibkr-csv-splitter";
import { validateCsvHeaders } from "./shared-utils";

/**
 * Parsed Flex Query result
 */
export interface ParsedFlexQuery {
  rows: CsvRowData[];
  headers: string[];
  errors: string[];
  rowCount: number;
}

/**
 * Parse Flex Query CSV into structured data
 *
 * @param csvContent Raw CSV string from Flex Query response
 * @returns Parsed data with CsvRowData rows
 */
export function parseFlexQueryCSV(csvContent: string): ParsedFlexQuery {
  const rows: CsvRowData[] = [];
  const errors: string[] = [];
  let headers: string[] = [];

  try {
    // Check if this is a multi-section IBKR CSV
    const isMultiSection = isMultiSectionIBKR(csvContent);
    let processedCsv = csvContent;

    if (isMultiSection) {
      try {
        processedCsv = extractTradesSection(csvContent);
      } catch (error) {
        errors.push(`Failed to extract IBKR sections: ${error}`);
        return { rows, headers, errors, rowCount: 0 };
      }
    }

    // Parse the CSV content synchronously
    const parseResult: ParseResult<string[]> = Papa.parse(processedCsv, {
      header: false,
      skipEmptyLines: true,
    });

    const rawCsvLines = parseResult.data;

    if (rawCsvLines.length === 0) {
      errors.push("The CSV content appears to be empty.");
      return { rows, headers, errors, rowCount: 0 };
    }

    // Extract headers from first row
    headers = rawCsvLines[0].map((h: string) => h.trim());

    // Validate headers
    if (!validateCsvHeaders(headers)) {
      errors.push("Invalid CSV headers. Expected at least 3 non-empty columns.");
      return { rows, headers, errors, rowCount: 0 };
    }

    // Process data rows (skip header row)
    for (let i = 1; i < rawCsvLines.length; i++) {
      const rawRow = rawCsvLines[i];
      const lineNumber = i + 1;
      const rowData: CsvRowData = {
        lineNumber: lineNumber.toString(),
        _SOURCE: "FLEX_API",
      };

      // Build row object
      headers.forEach((header, index) => {
        const value = rawRow[index];
        rowData[header] = typeof value === "string" ? value.trim() : (value ?? "");
      });

      rows.push(rowData);
    }

    if (rows.length === 0) {
      errors.push("No data rows found in CSV.");
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    errors.push(`Error parsing Flex Query CSV: ${msg}`);
  }

  return { rows, headers, errors, rowCount: rows.length };
}

/**
 * Get summary of parsed Flex Query data
 */
export function getFlexQuerySummary(parsed: ParsedFlexQuery): {
  tradeCount: number;
  dividendCount: number;
  feeCount: number;
  depositCount: number;
  withdrawalCount: number;
  forexCount: number;
  otherCount: number;
} {
  let tradeCount = 0;
  let dividendCount = 0;
  let feeCount = 0;
  let depositCount = 0;
  let withdrawalCount = 0;
  let forexCount = 0;
  let otherCount = 0;

  for (const row of parsed.rows) {
    const transactionType = (row.TransactionType || "").toString();
    const assetClass = (row.AssetClass || "").toString();
    const exchange = (row.Exchange || "").toString();
    const notesCodes = (row["Notes/Codes"] || "").toString().toLowerCase();

    // Trades: ExchTrade transactions (not forex)
    if (transactionType === "ExchTrade" && assetClass !== "CASH" && exchange !== "IDEALFX") {
      tradeCount++;
    }
    // Dividends
    else if (notesCodes.includes("dividend") || notesCodes.includes("div")) {
      dividendCount++;
    }
    // Withholding tax (count with dividends)
    else if (notesCodes.includes("withholding") || notesCodes.includes("tax")) {
      dividendCount++;
    }
    // Fees
    else if (notesCodes.includes("fee") || notesCodes.includes("commission")) {
      feeCount++;
    }
    // Deposits
    else if (notesCodes.includes("deposit")) {
      depositCount++;
    }
    // Withdrawals
    else if (notesCodes.includes("withdrawal")) {
      withdrawalCount++;
    }
    // Forex
    else if (assetClass === "CASH" || exchange === "IDEALFX") {
      forexCount++;
    }
    // Other
    else {
      otherCount++;
    }
  }

  return {
    tradeCount,
    dividendCount,
    feeCount,
    depositCount,
    withdrawalCount,
    forexCount,
    otherCount,
  };
}

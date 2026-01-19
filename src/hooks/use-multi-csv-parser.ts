import { useState, useCallback, useMemo } from "react";
import Papa, { ParseResult } from "papaparse";
import { CsvRowData, CsvRowError } from "../presets/types";
import { extractTradesSection, isMultiSectionIBKR } from "../lib/ibkr-csv-splitter";

// Input validation limits
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB per file
const MAX_FILES = 20;

// Validation function for headers
function validateHeaders(headers: string[]): boolean {
  return headers.length >= 3 && !headers.some((header) => !header || header.trim() === "");
}

// Validate file inputs before processing
function validateFileInputs(files: File[]): string | null {
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
    if (!file.name.toLowerCase().endsWith('.csv')) {
      return `File "${file.name}" is not a CSV file`;
    }
  }
  return null;
}

interface FileInfo {
  name: string;
  rowCount: number;
  size: number;
}

interface MultiCsvParserState {
  headers: string[];
  data: CsvRowData[];
  errors: CsvRowError[];
  isParsing: boolean;
  selectedFiles: File[];
  files: FileInfo[];
  rawCsvLines: string[][];
}

const initialState: MultiCsvParserState = {
  data: [],
  headers: [],
  errors: [],
  isParsing: false,
  selectedFiles: [],
  files: [],
  rawCsvLines: [],
};

export function useMultiCsvParser() {
  const [state, setState] = useState<MultiCsvParserState>(initialState);

  // Reset parser state
  const resetParserStates = useCallback(() => {
    setState(initialState);
  }, []);

  // Parse multiple CSV files
  const parseMultipleCsvFiles = useCallback(
    async (files: File[]) => {
      // Validate inputs first
      const validationError = validateFileInputs(files);
      if (validationError) {
        setState({
          ...initialState,
          selectedFiles: files,
          isParsing: false,
          errors: [{
            type: "FieldMismatch",
            code: "TooFewFields",
            message: validationError,
            row: 0,
          }],
        });
        return;
      }

      // Reset state before starting
      setState({
        ...initialState,
        selectedFiles: files,
        isParsing: true,
      });

      try {
        // Read all files as text
        const fileContents = await Promise.all(
          files.map(async (file) => {
            const text = await file.text();
            return { file, text };
          })
        );

        // Process and merge all IBKR CSV sections
        let mergedData: CsvRowData[] = [];
        let mergedHeaders: string[] = [];
        const fileInfos: FileInfo[] = [];
        const allErrors: CsvRowError[] = [];

        for (const { file, text } of fileContents) {
          try {
            // Check if this is a multi-section IBKR CSV
            const isMultiSection = isMultiSectionIBKR(text);
            let processedCsv = text;

            if (isMultiSection) {
              console.log(`Processing multi-section IBKR CSV: ${file.name}`);
              try {
                processedCsv = extractTradesSection(text);
              } catch (error) {
                const errorMsg = `Failed to extract IBKR sections from ${file.name}: ${error}`;
                console.error(errorMsg);
                allErrors.push({
                  type: "FieldMismatch",
                  code: "UndetectableDelimiter",
                  message: errorMsg,
                  row: 0,
                });
                continue; // Skip this file
              }
            }

            // Parse the CSV content
            const parseResult = await new Promise<ParseResult<string[]>>((resolve, reject) => {
              Papa.parse(processedCsv, {
                header: false,
                skipEmptyLines: true,
                complete: resolve,
                error: reject,
              });
            });

            const rawCsvLines = parseResult.data;

            if (rawCsvLines.length === 0) {
              const errorMsg = `The file ${file.name} appears to be empty.`;
              console.warn(errorMsg);
              allErrors.push({
                type: "FieldMismatch",
                code: "MissingQuotes",
                message: errorMsg,
                row: 0,
              });
              continue;
            }

            // Extract headers from first row
            const fileHeaders = rawCsvLines[0].map((h) => h.trim());

            // Validate headers
            if (!validateHeaders(fileHeaders)) {
              const errorMsg = `Invalid CSV headers in ${file.name}. Expected at least 3 non-empty columns.`;
              console.error(errorMsg);
              allErrors.push({
                type: "FieldMismatch",
                code: "TooFewFields",
                message: errorMsg,
                row: 0,
              });
              continue;
            }

            // Build union of all headers (each file may have different columns)
            // This ensures data from files with extra columns is parsed correctly
            if (mergedHeaders.length === 0) {
              mergedHeaders = [...fileHeaders];
            } else {
              // Add any new headers from this file that weren't in previous files
              for (const header of fileHeaders) {
                if (!mergedHeaders.includes(header)) {
                  mergedHeaders.push(header);
                }
              }
            }

            // Process data rows (skip header row)
            // IMPORTANT: Use this file's headers for column mapping, not the merged headers
            // This prevents misalignment when files have different column counts
            for (let i = 1; i < rawCsvLines.length; i++) {
              const rawRow = rawCsvLines[i];
              const lineNumber = mergedData.length + 2; // Global line number
              const rowData: CsvRowData = {
                lineNumber: lineNumber.toString(),
                _sourceFile: file.name, // Track which file this came from
              };

              // Check for row length mismatch against THIS file's headers
              if (rawRow.length < fileHeaders.length) {
                const message = `${file.name}, row ${i + 1}: Expected ${fileHeaders.length} fields but found ${rawRow.length}.`;
                console.warn(message);
                allErrors.push({
                  type: "FieldMismatch",
                  code: "TooFewFields",
                  message: message,
                  row: lineNumber,
                });
              }

              // Build row object using THIS FILE's headers (not merged headers)
              // This ensures correct column-to-value mapping regardless of header differences
              fileHeaders.forEach((header, index) => {
                const value = rawRow[index];
                rowData[header] = typeof value === "string" ? value.trim() : (value ?? "");
              });

              mergedData.push(rowData);
            }

            // Track file info
            fileInfos.push({
              name: file.name,
              rowCount: rawCsvLines.length - 1, // Exclude header
              size: file.size,
            });
          } catch (error) {
            const errorMsg = `Error processing ${file.name}: ${error}`;
            console.error(errorMsg);
            allErrors.push({
              type: "FieldMismatch",
              code: "UndetectableDelimiter",
              message: errorMsg,
              row: 0,
            });
          }
        }

        // Check if we got any data
        if (mergedData.length === 0) {
          const errorMsg = "No valid data found in any of the selected files.";
          console.error(errorMsg);
          setState({
            ...initialState,
            selectedFiles: files,
            isParsing: false,
            errors: [
              {
                type: "FieldMismatch",
                code: "TooFewFields",
                message: errorMsg,
                row: 0,
              },
              ...allErrors,
            ],
          });
          return;
        }

        // Successful parsing
        console.log(
          `Successfully parsed ${files.length} files with ${mergedData.length} total rows`
        );

        setState({
          ...initialState,
          selectedFiles: files,
          data: mergedData,
          headers: mergedHeaders,
          files: fileInfos,
          isParsing: false,
          errors: allErrors,
        });
      } catch (error) {
        const errorMsg = `Unexpected error parsing files: ${error}`;
        console.error(errorMsg);
        setState({
          ...initialState,
          selectedFiles: files,
          isParsing: false,
          errors: [
            {
              type: "FieldMismatch",
              code: "UndetectableDelimiter",
              message: errorMsg,
              row: 0,
            },
          ],
        });
      }
    },
    []
  );

  // Prepare errors for display (show file-level errors first)
  const displayErrors = useMemo(() => {
    const fileLevelErrors = state.errors.filter((error) => error.row === 0);
    if (fileLevelErrors.length > 0) {
      return fileLevelErrors;
    }
    return state.errors;
  }, [state.errors]);

  return {
    data: state.data,
    headers: state.headers,
    errors: displayErrors,
    isParsing: state.isParsing,
    selectedFiles: state.selectedFiles,
    files: state.files, // Info about each parsed file
    rawData: state.rawCsvLines,
    parseMultipleCsvFiles,
    resetParserStates,
  };
}

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import Papa, { ParseResult } from "papaparse";
import { CsvRowData, CsvRowError } from "../presets/types";
import { extractTradesSection, isMultiSectionIBKR } from "../lib/ibkr-csv-splitter";
import { MAX_FILE_SIZE_BYTES, MAX_FILES, FILE_READ_TIMEOUT_MS } from "../lib/constants";
import { debug } from "../lib/debug-logger";
import { getErrorMessage, validateCsvHeaders } from "../lib/shared-utils";

/**
 * Read file with timeout to prevent hanging UI
 */
async function readFileWithTimeout(file: File, timeoutMs: number): Promise<string> {
  return Promise.race([
    file.text(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`File read timed out after ${timeoutMs / 1000}s`)), timeoutMs)
    ),
  ]);
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
}

const initialState: MultiCsvParserState = {
  data: [],
  headers: [],
  errors: [],
  isParsing: false,
  selectedFiles: [],
  files: [],
};

export function useMultiCsvParser() {
  const [state, setState] = useState<MultiCsvParserState>(initialState);

  // Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
        if (!isMountedRef.current) return;
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
      if (!isMountedRef.current) return;
      setState({
        ...initialState,
        selectedFiles: files,
        isParsing: true,
      });

      try {
        // Read all files as text with timeout (handle individual file read errors)
        const fileReadResults = await Promise.all(
          files.map(async (file) => {
            try {
              const text = await readFileWithTimeout(file, FILE_READ_TIMEOUT_MS);
              return { file, text, error: null };
            } catch (readError) {
              return {
                file,
                text: null,
                error: getErrorMessage(readError)
              };
            }
          })
        );

        // Separate successful reads from errors
        const allErrors: CsvRowError[] = [];
        const fileContents: { file: File; text: string }[] = [];

        for (const result of fileReadResults) {
          if (result.error || result.text === null) {
            allErrors.push({
              type: "Delimiter", // More accurate: file read errors are I/O issues
              code: "FileReadError",
              message: `Failed to read file "${result.file.name}": ${result.error || "Unknown error"}`,
              row: 0,
            });
          } else {
            fileContents.push({ file: result.file, text: result.text });
          }
        }

        // Process and merge all IBKR CSV sections
        let mergedData: CsvRowData[] = [];
        let mergedHeaders: string[] = [];
        const fileInfos: FileInfo[] = [];

        for (const { file, text } of fileContents) {
          try {
            // Check if this is a multi-section IBKR CSV
            const isMultiSection = isMultiSectionIBKR(text);
            let processedCsv = text;

            if (isMultiSection) {
              debug.log(`Processing multi-section IBKR CSV: ${file.name}`);
              try {
                processedCsv = extractTradesSection(text);
              } catch (error) {
                const errorMsg = `Failed to extract IBKR sections from ${file.name}: ${error}`;
                debug.error(errorMsg);
                allErrors.push({
                  type: "Delimiter", // IBKR section extraction failed
                  code: "IBKRSectionError",
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

            // Handle PapaParse errors (malformed CSV, delimiter issues, etc.)
            if (parseResult.errors && parseResult.errors.length > 0) {
              for (const parseError of parseResult.errors) {
                allErrors.push({
                  type: parseError.type || "FieldMismatch",
                  code: parseError.code || "UndetectableDelimiter",
                  message: `${file.name}: ${parseError.message || "Parse error"}`,
                  row: parseError.row ?? 0,
                });
              }
              // If there are fatal parse errors and no data, skip this file
              if (rawCsvLines.length === 0) {
                continue;
              }
            }

            if (rawCsvLines.length === 0) {
              const errorMsg = `The file ${file.name} appears to be empty.`;
              debug.warn(errorMsg);
              allErrors.push({
                type: "Delimiter",
                code: "EmptyFile",
                message: errorMsg,
                row: 0,
              });
              continue;
            }

            // Extract headers from first row
            const fileHeaders = rawCsvLines[0].map((h) => h.trim());

            // Validate headers
            if (!validateCsvHeaders(fileHeaders)) {
              const errorMsg = `Invalid CSV headers in ${file.name}. Expected at least 3 non-empty columns.`;
              debug.error(errorMsg);
              allErrors.push({
                type: "FieldMismatch",
                code: "InvalidHeaders",
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
                debug.warn(message);
                allErrors.push({
                  type: "FieldMismatch",
                  code: "TooFewFields",
                  message: message,
                  row: lineNumber,
                });
              }

              // Build row object using THIS FILE's headers (not merged headers)
              // This ensures correct column-to-value mapping regardless of header differences
              // Track if row has fewer columns than headers (potential data loss)
              if (rawRow.length < fileHeaders.length) {
                debug.warn(`[CSV Parser] Row ${lineNumber} in ${file.name} has ${rawRow.length} columns but expected ${fileHeaders.length}`);
              }
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
            debug.error(errorMsg);
            allErrors.push({
              type: "Delimiter",
              code: "ProcessingError",
              message: errorMsg,
              row: 0,
            });
          }
        }

        // Check if we got any data
        if (mergedData.length === 0) {
          const genericErrorMsg = "No valid data found in any of the selected files.";
          debug.error(genericErrorMsg);
          // Prioritize specific file errors over generic message so users see actual causes first
          const errorsToShow = allErrors.length > 0
            ? allErrors
            : [{
                type: "Delimiter" as const,
                code: "NoValidData" as const,
                message: genericErrorMsg,
                row: 0,
              }];
          if (!isMountedRef.current) return;
          setState({
            ...initialState,
            selectedFiles: files,
            isParsing: false,
            errors: errorsToShow,
          });
          return;
        }

        // Successful parsing
        debug.log(
          `Successfully parsed ${files.length} files with ${mergedData.length} total rows`
        );

        if (!isMountedRef.current) return;
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
        debug.error(errorMsg);
        if (!isMountedRef.current) return;
        setState({
          ...initialState,
          selectedFiles: files,
          isParsing: false,
          errors: [
            {
              type: "Delimiter",
              code: "UnexpectedError",
              message: errorMsg,
              row: 0,
            },
          ],
        });
      }
    },
    // Empty dependency array is intentional: parseMultipleCsvFiles only depends on
    // setState which is stable, and constants (MAX_FILE_SIZE_BYTES, etc.) which never change.
    // This prevents unnecessary recreation of the callback and potential stale closures.
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
    parseMultipleCsvFiles,
    resetParserStates,
  };
}

/**
 * IBKR CSV Section Splitter
 *
 * IBKR exports contain multiple concatenated CSV sections with different schemas:
 * - Section 1 (85 cols): Trades, Stock transactions, Fees, Interest
 * - Section 2 (45 cols): Dividends, Cash transactions
 * - Section 3 (55 cols): Transfers, Position movements
 *
 * This utility extracts only Section 1, which contains the importable transactions.
 */

const IBKR_HEADER_START = '"ClientAccountID"';

export interface CsvSection {
  header: string;
  rows: string[];
  lineStart: number;
  lineEnd: number;
  columnCount: number;
}

/**
 * Detect all CSV sections in IBKR export
 */
function detectIBKRSections(csvContent: string): CsvSection[] {
  const lines = csvContent.split(/\r?\n/);
  const sections: CsvSection[] = [];
  let currentSection: CsvSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect header line
    if (line.startsWith(IBKR_HEADER_START)) {
      // Save previous section if exists
      if (currentSection) {
        currentSection.lineEnd = i - 1;
        sections.push(currentSection);
      }

      // Start new section
      const columnCount = line.split(',').length;
      currentSection = {
        header: line,
        rows: [],
        lineStart: i + 1,
        lineEnd: lines.length - 1,
        columnCount,
      };
    } else if (currentSection && line.trim()) {
      // Add data row to current section
      currentSection.rows.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Detect section type based on column structure (not position!)
 * IBKR can export sections in any order, so we identify by columns.
 */
function detectSectionType(headers: string[]): 'trades' | 'dividends' | 'transfers' | 'unknown' {
  const headerSet = new Set(headers.map(h => h.replace(/^"|"$/g, '')));

  // Trades section: has TransactionType, Exchange, Buy/Sell columns
  if (headerSet.has('TransactionType') && headerSet.has('Exchange') && headerSet.has('Buy/Sell')) {
    return 'trades';
  }

  // Dividends/Cash section: has Date/Time and Amount columns (but not TransactionType)
  if (headerSet.has('Date/Time') && headerSet.has('Amount') && !headerSet.has('TransactionType')) {
    return 'dividends';
  }

  // Transfers section: has Direction, TransferCompany, CashTransfer columns
  if (headerSet.has('Direction') && headerSet.has('TransferCompany') && headerSet.has('CashTransfer')) {
    return 'transfers';
  }

  return 'unknown';
}

/**
 * Normalize column names across different IBKR sections
 * Maps section-specific column names to standard names used by trades section
 */
function normalizeHeaders(headers: string[], sectionType: 'trades' | 'dividends' | 'transfers' | 'unknown'): string[] {
  // Trades section: already has standard names, no changes needed
  if (sectionType === 'trades') {
    return headers;
  }

  // Dividends/Cash section: map different column names to trades section format
  if (sectionType === 'dividends') {
    return headers.map(header => {
      const h = header.replace(/^"|"$/g, ''); // Remove quotes

      // Map dividends section columns to trades section equivalents
      const mapping: Record<string, string> = {
        'Date/Time': 'TradeDate',        // Dividends section uses "Date/Time" for date
        'Amount': 'TradeMoney',          // Dividends section uses "Amount" for transaction amount
        'Type': 'Notes/Codes',           // Dividends section uses "Type" for transaction category
        'Code': 'TransactionType',       // Dividends section uses "Code" for transaction type
      };

      return `"${mapping[h] || h}"`;
    });
  }

  // Transfers section: map column names to trades section format
  if (sectionType === 'transfers') {
    return headers.map(header => {
      const h = header.replace(/^"|"$/g, '');

      // Map transfers section columns to trades section equivalents
      const mapping: Record<string, string> = {
        'Date': 'TradeDate',             // Transfers section uses "Date" for date
        'Type': 'TransactionType',       // Transfers section uses "Type" for transaction type (INTERNAL, ACATS, etc.)
        'Direction': '_TRANSFER_DIRECTION', // Preserve Direction (IN/OUT) as custom field
        'CashTransfer': 'TradeMoney',    // CashTransfer contains the cash amount for transfers
        'TransferCompany': 'Exchange',   // TransferCompany for context
      };

      return `"${mapping[h] || h}"`;
    });
  }

  return headers;
}

/**
 * Merge all IBKR sections into a single CSV with normalized column names
 *
 * IBKR exports have 3 sections with different schemas:
 * - Section 1: Trades (BUY/SELL) with 85 columns
 * - Section 2: Dividends, taxes, fees, interest (45 columns)
 * - Section 3: Transfers, position movements (53 columns)
 *
 * This function:
 * 1. Parses each section separately
 * 2. Normalizes column names so all sections use Section 1's naming
 * 3. Merges rows from all sections
 * 4. Returns a single CSV with Section 1's header + all data rows
 *
 * @param csvContent Full IBKR CSV content
 * @returns Merged CSV content with normalized columns
 */
export function extractTradesSection(csvContent: string): string {
  const sections = detectIBKRSections(csvContent);

  if (sections.length === 0) {
    throw new Error('No valid IBKR sections found in CSV');
  }

  // Find the trades section to use as base header (order may vary!)
  const tradesSection = sections.find(section => {
    const headers = section.header.split(',').map(h => h.trim());
    return detectSectionType(headers) === 'trades';
  });

  if (!tradesSection) {
    throw new Error('No trades section found in IBKR CSV');
  }

  const baseHeaders = tradesSection.header.split(',').map(h => h.trim());

  // Collect all unique normalized headers from all sections
  const allNormalizedHeaders = new Set<string>(baseHeaders.map(h => h.replace(/^"|"$/g, '')));

  for (const section of sections) {
    const sectionHeaders = section.header.split(',').map(h => h.trim());
    const sectionType = detectSectionType(sectionHeaders);
    const normalizedHeaders = normalizeHeaders(sectionHeaders, sectionType);

    normalizedHeaders.forEach(header => {
      const cleanHeader = header.replace(/^"|"$/g, '');
      allNormalizedHeaders.add(cleanHeader);
    });
  }

  // Build final header list: start with base headers, then add new columns
  const finalHeaders = [...baseHeaders.map(h => h.replace(/^"|"$/g, ''))];
  allNormalizedHeaders.forEach(header => {
    if (!finalHeaders.includes(header)) {
      finalHeaders.push(header);
    }
  });

  // Collect all data rows from all sections
  const allRows: string[] = [];

  for (const section of sections) {
    const sectionHeaders = section.header.split(',').map(h => h.trim());
    const sectionType = detectSectionType(sectionHeaders);
    const normalizedHeaders = normalizeHeaders(sectionHeaders, sectionType);

    // For each data row in this section, map values to final header positions
    for (const row of section.rows) {
      const values = row.split(',').map(v => v.trim());

      // Create a map of normalized header -> value
      const valueMap = new Map<string, string>();
      normalizedHeaders.forEach((header, index) => {
        if (index < values.length) {
          valueMap.set(header.replace(/^"|"$/g, ''), values[index]);
        }
      });

      // Build output row using final headers order
      const outputValues = finalHeaders.map(header => {
        return valueMap.get(header) || '""'; // Empty string if column doesn't exist in this section
      });

      allRows.push(outputValues.join(','));
    }
  }

  // Return merged CSV: final header (with quotes) + all normalized rows
  const finalHeaderRow = finalHeaders.map(h => `"${h}"`).join(',');
  return [finalHeaderRow, ...allRows].join('\n');
}

/**
 * Check if a CSV file is a multi-section IBKR export
 */
export function isMultiSectionIBKR(csvContent: string): boolean {
  const headerMatches = csvContent.match(new RegExp(IBKR_HEADER_START, 'g'));
  return (headerMatches?.length || 0) > 1;
}


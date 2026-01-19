/**
 * Shared type definitions for the IBKR Multi-Currency Import addon
 */
import type { Account, ActivityImport, ActivityDetails } from '@wealthfolio/addon-sdk';

// Re-export commonly used SDK types
export type { ActivityDetails };

/**
 * Ticker search result from the Wealthfolio API
 */
export interface TickerSearchResult {
  symbol: string;
  name?: string;
  exchange?: string;
  score?: number;
  [key: string]: unknown;
}

/**
 * Preview of an account to be created or reused during import
 */
export interface AccountPreview {
  /** Currency code (e.g., "USD", "EUR", "GBP") */
  currency: string;
  /** Account name (editable by user) */
  name: string;
  /** Account group name (optional for some contexts) */
  group?: string;
  /** Number of transactions for this currency (optional for some contexts) */
  transactionCount?: number;
  /** Existing account if one matches, undefined if new account will be created */
  existingAccount?: Account;
}

/**
 * Summary of transaction types in a group
 */
export interface TransactionSummary {
  trades: number;
  dividends: number;
  deposits: number;
  withdrawals: number;
  fees: number;
  other: number;
}

/**
 * Group of transactions for a specific currency account
 */
export interface TransactionGroup {
  /** Currency code */
  currency: string;
  /** Account name */
  accountName: string;
  /** List of transactions to import */
  transactions: ActivityImport[];
  /** Summary of transaction types */
  summary: TransactionSummary;
}

/**
 * Result of importing transactions to a single account
 */
export interface ImportResult {
  /** Account ID */
  accountId: string;
  /** Account name */
  accountName: string;
  /** Currency code */
  currency: string;
  /** Number of successfully imported transactions */
  success: number;
  /** Number of failed transactions */
  failed: number;
  /** Number of skipped (duplicate) transactions */
  skipped: number;
  /** Error messages, if any */
  errors: string[];
}

/**
 * Activity data used for deduplication comparison
 * Note: activityDate should be a string (ISO date format: "YYYY-MM-DD")
 */
export interface ActivityFingerprint {
  activityDate: string;
  assetId: string;
  activityType: string;
  quantity: number;
  unitPrice: number;
  amount?: number;
  fee: number;
  currency: string;
  comment?: string;
}

/**
 * Progress indicator for async operations
 */
export interface ProgressInfo {
  current: number;
  total: number;
  message?: string;
}

/**
 * Error that occurred during activity conversion
 */
export interface ConversionError {
  /** Row index in the original data */
  rowIndex: number;
  /** Symbol or description of the failed row */
  identifier: string;
  /** Error message */
  message: string;
  /** The raw row data that failed */
  rowData?: Record<string, unknown>;
}

/**
 * Result of converting IBKR rows to activities
 */
export interface ConversionResult {
  /** Successfully converted activities */
  activities: import("@wealthfolio/addon-sdk").ActivityImport[];
  /** Errors that occurred during conversion */
  errors: ConversionError[];
  /** Number of rows skipped (unrecognized type, no account, etc.) */
  skipped: number;
}

/**
 * Processed IBKR row after preprocessing
 * Extends the raw CSV data with internal classification and resolution fields
 */
export interface ProcessedIBKRRow {
  // Account info
  ClientAccountID?: string;
  AccountAlias?: string;
  CurrencyPrimary?: string;
  FXRateToBase?: string;

  // Asset info
  AssetClass?: string;
  Symbol?: string;
  Description?: string;
  SecurityID?: string;
  CUSIP?: string;
  ISIN?: string;
  FIGI?: string;
  ListingExchange?: string;

  // Transaction info
  TransactionType?: string;
  Exchange?: string;
  Quantity?: string;
  TradePrice?: string;
  TradeMoney?: string;
  TradeDate?: string;
  Date?: string;
  ReportDate?: string;

  // Activity info
  ActivityCode?: string;
  ActivityDescription?: string;

  // Fee info
  IBCommission?: string;
  Taxes?: string;

  // Level of detail (for FX trades)
  LevelOfDetail?: string;

  // Internal fields added by preprocessor
  _IBKR_TYPE?: string;
  _resolvedTicker?: string;

  // Allow additional dynamic fields from CSV
  [key: string]: string | undefined;
}

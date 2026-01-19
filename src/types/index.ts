/**
 * Shared type definitions for the IBKR Multi-Currency Import addon
 */
import type { Account, ActivityImport } from '@wealthfolio/addon-sdk';

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

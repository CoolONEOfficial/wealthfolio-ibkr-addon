/**
 * IBKR CSV Transaction Row types
 */

/**
 * Raw IBKR transaction row from CSV
 * Contains all possible fields from different IBKR CSV sections
 */
export interface IBKRTransactionRow {
  // Account info
  ClientAccountID?: string;
  AccountAlias?: string;
  Model?: string;
  CurrencyPrimary?: string;
  FXRateToBase?: string;

  // Asset info
  AssetClass?: string;
  SubCategory?: string;
  Symbol?: string;
  Description?: string;
  Conid?: string;
  SecurityID?: string;
  SecurityIDType?: string;
  CUSIP?: string;
  ISIN?: string;
  FIGI?: string;
  ListingExchange?: string;

  // Transaction info
  TransactionType?: string;
  Exchange?: string;
  "Buy/Sell"?: string;
  Quantity?: string;
  TradeQuantity?: string;
  TradePrice?: string;
  TradeMoney?: string;
  TradeDate?: string;
  DateTime?: string;
  SettleDate?: string;
  "Notes/Codes"?: string;

  // Activity info (from trades section)
  ActivityCode?: string;
  ActivityDescription?: string;

  // Fee info
  IBCommission?: string;
  TradeCommission?: string;
  TradeTax?: string;
  TradeGross?: string;
  Proceeds?: string;

  // Cash info
  NetCash?: string;
  Debit?: string;
  Credit?: string;
  Amount?: string;
  Balance?: string;

  // Dividend-specific columns (shifted in dividends section)
  PrincipalAdjustFactor?: string;
  Expiry?: string;

  // Transfer-specific fields
  _TRANSFER_DIRECTION?: string;
  TransferCompany?: string;
  CashTransfer?: string;
  Direction?: string;

  // Other fields
  TradeID?: string;
  OrderID?: string;
  TransactionID?: string;
  ReportDate?: string;
  LevelOfDetail?: string;
}

/**
 * Classification result for IBKR transaction
 */
export interface IBKRClassification {
  classification:
    | "STOCK_BUY"
    | "STOCK_SELL"
    | "DIVIDEND_PAYMENT"
    | "DIVIDEND_TAX"
    | "FEE"
    | "DEPOSIT"
    | "WITHDRAWAL"
    | "TRANSFER_IN"
    | "TRANSFER_OUT"
    | "INTEREST"
    | "FX_CONVERSION"
    | "FX_DEPOSIT"
    | "FX_WITHDRAWAL"
    | "SECTION2_DUPLICATE"
    | "FX_ADJUSTMENT"
    | "SUMMARY_ROW"
    | "EMPTY_ROW"
    | "UNKNOWN";
  shouldImport: boolean;
  warningMessages: string[];
  originalRow: IBKRTransactionRow;
}

/**
 * Simple CSV row data type for internal use
 */
export type CsvRowData = Record<string, string | undefined>;

/**
 * CSV row error type for internal use
 */
export interface CsvRowError {
  row: number;
  message: string;
  type?: string;
  code?: string;
}

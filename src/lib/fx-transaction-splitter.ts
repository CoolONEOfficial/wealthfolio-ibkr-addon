import type { Account, ActivityImport } from "@wealthfolio/addon-sdk";
import { debug } from "./debug-logger";
import { createCashSymbol } from "./shared-utils";

/**
 * Information about a skipped FX conversion
 */
export interface SkippedFXConversion {
  /** Original transaction symbol (e.g., "GBP.USD") */
  symbol: string;
  /** Reason the conversion was skipped */
  reason: string;
  /** Source currency code */
  sourceCurrency?: string;
  /** Target currency code */
  targetCurrency?: string;
  /** Source amount that would have been withdrawn */
  sourceAmount?: number;
  /** Target amount that would have been deposited */
  targetAmount?: number;
}

/**
 * Result of splitting FX conversions
 */
export interface SplitFXConversionsResult {
  /** Processed transactions with FX conversions split into pairs */
  transactions: ActivityImport[];
  /** FX conversions that were skipped (missing accounts, invalid format, etc.) */
  skippedConversions: SkippedFXConversion[];
  /** Total number of FX conversions found */
  totalFXConversions: number;
  /** Number of FX conversions successfully split */
  successfulSplits: number;
}

/**
 * Split FX conversion transactions into withdrawal + deposit pairs
 *
 * IBKR FX conversions are represented as single FOREX transactions with:
 * - Symbol format: "GBP.USD" (source.target)
 * - Negative quantity: amount sold from source currency
 * - TradeMoney/amount: amount received in target currency
 *
 * We split these into:
 * 1. WITHDRAWAL from source currency account (e.g., GBP)
 * 2. DEPOSIT to target currency account (e.g., USD)
 *
 * @param transactions - Array of classified transactions (including FX_CONVERSION types)
 * @param accountsByCurrency - Map of currency code to Account object
 * @returns Result object with transactions and information about any skipped conversions
 */
export function splitFXConversions(
  transactions: ActivityImport[],
  accountsByCurrency: Map<string, Account>
): SplitFXConversionsResult {
  // Validate inputs - return empty result for null/undefined
  if (!transactions || !Array.isArray(transactions)) {
    debug.warn("splitFXConversions: Invalid transactions input");
    return {
      transactions: [],
      skippedConversions: [],
      totalFXConversions: 0,
      successfulSplits: 0,
    };
  }

  if (!accountsByCurrency || !(accountsByCurrency instanceof Map)) {
    debug.warn("splitFXConversions: Invalid accountsByCurrency input");
    return {
      transactions: [...transactions], // Pass through unchanged
      skippedConversions: [],
      totalFXConversions: 0,
      successfulSplits: 0,
    };
  }

  const result: ActivityImport[] = [];
  const skippedConversions: SkippedFXConversion[] = [];
  let fxConversionCount = 0;
  let successfulSplits = 0;

  for (const transaction of transactions) {
    // Skip null/undefined transactions
    if (!transaction) {
      continue;
    }

    // Pass through non-FX transactions unchanged
    if (!isFXConversion(transaction)) {
      result.push(transaction);
      continue;
    }

    fxConversionCount++;

    // Parse FX transaction to extract currencies and amounts
    const fxDetails = parseFXTransaction(transaction);
    if (!fxDetails) {
      debug.warn("Could not parse FX transaction, skipping:", transaction);
      skippedConversions.push({
        symbol: transaction.symbol || "unknown",
        reason: "Invalid FX transaction format - could not parse currencies or amounts",
      });
      continue;
    }

    const {
      sourceCurrency,
      targetCurrency,
      sourceAmount,
      targetAmount,
      comment,
    } = fxDetails;

    // Check if both accounts exist
    const sourceAccount = accountsByCurrency.get(sourceCurrency);
    const targetAccount = accountsByCurrency.get(targetCurrency);

    if (!sourceAccount) {
      debug.warn(
        `Skipping FX conversion: ${sourceCurrency} account not found`
      );
      skippedConversions.push({
        symbol: transaction.symbol || "unknown",
        reason: `Source account for ${sourceCurrency} not found - cannot create withdrawal`,
        sourceCurrency,
        targetCurrency,
        sourceAmount,
        targetAmount,
      });
      continue;
    }

    if (!targetAccount) {
      debug.warn(
        `Skipping FX conversion: ${targetCurrency} account not found`
      );
      skippedConversions.push({
        symbol: transaction.symbol || "unknown",
        reason: `Target account for ${targetCurrency} not found - cannot create deposit`,
        sourceCurrency,
        targetCurrency,
        sourceAmount,
        targetAmount,
      });
      continue;
    }

    // Create WITHDRAWAL from source account
    const withdrawal: ActivityImport = {
      ...transaction,
      activityType: "WITHDRAWAL",
      symbol: createCashSymbol(sourceCurrency),
      currency: sourceCurrency,
      quantity: 0,
      unitPrice: 0,
      amount: Math.abs(sourceAmount),
      fee: 0,
      comment: comment || `FX conversion to ${targetCurrency}`,
      isDraft: false,
      isValid: true,
    };

    // Create DEPOSIT to target account
    const deposit: ActivityImport = {
      ...transaction,
      activityType: "DEPOSIT",
      symbol: createCashSymbol(targetCurrency),
      currency: targetCurrency,
      quantity: 0,
      unitPrice: 0,
      amount: Math.abs(targetAmount),
      fee: 0,
      comment: comment || `FX conversion from ${sourceCurrency}`,
      isDraft: false,
      isValid: true,
    };

    result.push(withdrawal);
    result.push(deposit);
    successfulSplits++;
  }

  if (fxConversionCount > 0) {
    debug.log(
      `Processed ${fxConversionCount} FX conversions, created ${successfulSplits * 2} transactions, skipped ${skippedConversions.length}`
    );
  }

  return {
    transactions: result,
    skippedConversions,
    totalFXConversions: fxConversionCount,
    successfulSplits,
  };
}

/**
 * Check if a transaction is an FX conversion
 * IBKR FX conversions have symbols like "GBP.USD", "EUR.USD", etc.
 */
function isFXConversion(transaction: ActivityImport): boolean {
  // Check if symbol matches FX format: XXX.YYY (currency pair)
  const symbol = transaction.symbol || "";
  const fxPattern = /^[A-Z]{3}\.[A-Z]{3}$/;

  // Also check for FOREX exchange or IDEALFX in the comment
  const comment = transaction.comment?.toLowerCase() || "";
  const isForexExchange =
    symbol.includes(".") &&
    (comment.includes("forex trade") || comment.includes("idealfx"));

  return fxPattern.test(symbol) || isForexExchange;
}

/**
 * Parse FX transaction to extract details
 */
function parseFXTransaction(transaction: ActivityImport): {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  targetAmount: number;
  comment: string;
} | null {
  const symbol = transaction.symbol || "";

  // Parse currency pair from symbol (e.g., "GBP.USD" -> GBP is source, USD is target)
  const parts = symbol.split(".");
  if (parts.length !== 2) {
    debug.warn(`Invalid FX symbol format: ${symbol}`);
    return null;
  }

  const sourceCurrency = parts[0];
  const targetCurrency = parts[1];

  // Validate currency codes are exactly 3 uppercase letters
  const currencyPattern = /^[A-Z]{3}$/;
  if (!currencyPattern.test(sourceCurrency) || !currencyPattern.test(targetCurrency)) {
    debug.warn(`Invalid currency codes in FX symbol: ${symbol} (source: ${sourceCurrency}, target: ${targetCurrency})`);
    return null;
  }

  // Source amount is the quantity (negative in IBKR for sales, we want absolute value)
  const sourceAmount = Math.abs(transaction.quantity || 0);

  // Calculate target amount from exchange rate * source amount
  // In IBKR: TradePrice contains the exchange rate
  // Example: Selling 1 GBP at rate 1.26525 = 1.26525 USD received
  let targetAmount = 0;
  if (transaction.unitPrice && sourceAmount) {
    targetAmount = Math.abs(sourceAmount * transaction.unitPrice);
  }

  // Fallback: If we don't have unitPrice, use the amount field
  // (though in IBKR this is usually the net proceeds in base currency)
  if (targetAmount === 0) {
    targetAmount = Math.abs(transaction.amount || 0);
  }

  const comment = transaction.comment || `FX: ${sourceCurrency} → ${targetCurrency}`;

  debug.log(`FX Conversion: ${sourceAmount} ${sourceCurrency} → ${targetAmount.toFixed(2)} ${targetCurrency} (rate: ${transaction.unitPrice})`);

  return {
    sourceCurrency,
    targetCurrency,
    sourceAmount,
    targetAmount,
    comment,
  };
}


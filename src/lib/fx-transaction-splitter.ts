import type { Account, ActivityImport } from "@wealthfolio/addon-sdk";

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
 * @returns Array with FX conversions replaced by withdrawal/deposit pairs
 */
export function splitFXConversions(
  transactions: ActivityImport[],
  accountsByCurrency: Map<string, Account>
): ActivityImport[] {
  const result: ActivityImport[] = [];
  let fxConversionCount = 0;
  let fxSkippedCount = 0;

  for (const transaction of transactions) {
    // Pass through non-FX transactions unchanged
    if (!isFXConversion(transaction)) {
      result.push(transaction);
      continue;
    }

    fxConversionCount++;

    // Parse FX transaction to extract currencies and amounts
    const fxDetails = parseFXTransaction(transaction);
    if (!fxDetails) {
      console.warn("Could not parse FX transaction, skipping:", transaction);
      fxSkippedCount++;
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
      console.warn(
        `Skipping FX conversion: ${sourceCurrency} account not found`
      );
      fxSkippedCount++;
      continue;
    }

    if (!targetAccount) {
      console.warn(
        `Skipping FX conversion: ${targetCurrency} account not found`
      );
      fxSkippedCount++;
      continue;
    }

    // Create WITHDRAWAL from source account
    const withdrawal: ActivityImport = {
      ...transaction,
      activityType: "WITHDRAWAL",
      symbol: `$CASH-${sourceCurrency}`,
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
      symbol: `$CASH-${targetCurrency}`,
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
  }

  if (fxConversionCount > 0) {
    console.log(
      `Processed ${fxConversionCount} FX conversions, created ${(fxConversionCount - fxSkippedCount) * 2} transactions, skipped ${fxSkippedCount}`
    );
  }

  return result;
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
    console.warn(`Invalid FX symbol format: ${symbol}`);
    return null;
  }

  const sourceCurrency = parts[0];
  const targetCurrency = parts[1];

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

  console.log(`FX Conversion: ${sourceAmount} ${sourceCurrency} → ${targetAmount.toFixed(2)} ${targetCurrency} (rate: ${transaction.unitPrice})`);

  return {
    sourceCurrency,
    targetCurrency,
    sourceAmount,
    targetAmount,
    comment,
  };
}


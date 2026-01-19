/**
 * Dividend FX Calculations Test Suite
 *
 * Tests the dividend and tax amount calculations in activity-converter.ts,
 * specifically the FX conversion logic for cross-currency dividends.
 *
 * Critical scenarios covered:
 * - Dividend calculation using per-share × position
 * - Dividend calculation with FX conversion fallback
 * - Tax calculation with FX conversion
 * - Edge cases: position = 0, no FX rate, invalid rates
 */

import { describe, it, expect } from 'vitest';
import { convertToActivityImports, buildFXRateLookup } from '../lib/activity-converter';
import type { AccountPreview, ProcessedIBKRRow } from '../types';

// Helper to create a minimal account preview
function createAccountPreview(currency: string): AccountPreview {
  return {
    currency,
    name: `Test - ${currency}`,
    existingAccount: undefined,
  };
}

// Helper to create a BUY transaction for position building
function createBuyRow(symbol: string, quantity: number, date: string, currency = 'GBP'): ProcessedIBKRRow {
  return {
    _IBKR_TYPE: 'IBKR_BUY',
    Symbol: symbol,
    Quantity: String(quantity),
    TradePrice: '100.00',
    TradeMoney: String(quantity * 100),
    Date: date,
    CurrencyPrimary: currency,
    ListingExchange: 'NYSE',
  };
}

// Helper to create a dividend row
function createDividendRow(
  symbol: string,
  tradeMoney: number,
  date: string,
  description: string,
  currency = 'GBP'
): ProcessedIBKRRow {
  return {
    _IBKR_TYPE: 'IBKR_DIVIDEND',
    Symbol: symbol,
    TradeMoney: String(tradeMoney),
    Date: date,
    ActivityDescription: description,
    CurrencyPrimary: currency,
  };
}

// Helper to create a tax row
function createTaxRow(
  symbol: string,
  tradeMoney: number,
  date: string,
  description: string,
  currency = 'GBP'
): ProcessedIBKRRow {
  return {
    _IBKR_TYPE: 'IBKR_TAX',
    Symbol: symbol,
    TradeMoney: String(tradeMoney),
    Date: date,
    ActivityDescription: description,
    CurrencyPrimary: currency,
  };
}

// Helper to create an FX trade row for rate lookup
function createFXTradeRow(
  symbol: string, // e.g., "GBP.USD"
  tradePrice: number,
  date: string
): ProcessedIBKRRow {
  return {
    Symbol: symbol,
    TradePrice: String(tradePrice),
    TradeDate: date,
    LevelOfDetail: 'EXECUTION',
  };
}

describe('Dividend FX Calculations', () => {
  describe('buildFXRateLookup', () => {
    it('should extract FX rates from FX trade rows', () => {
      const rows: ProcessedIBKRRow[] = [
        createFXTradeRow('GBP.USD', 1.25, '2024-01-15'),
        createFXTradeRow('EUR.USD', 1.10, '2024-01-15'),
      ];

      const lookup = buildFXRateLookup(rows);

      expect(lookup.has('GBP/USD')).toBe(true);
      expect(lookup.has('USD/GBP')).toBe(true); // Inverse
      expect(lookup.has('EUR/USD')).toBe(true);

      const gbpUsdRates = lookup.get('GBP/USD')!;
      expect(gbpUsdRates[0].rate).toBe(1.25);
      expect(gbpUsdRates[0].date).toBe('2024-01-15');
    });

    it('should store inverse rates', () => {
      const rows: ProcessedIBKRRow[] = [
        createFXTradeRow('GBP.USD', 1.25, '2024-01-15'),
      ];

      const lookup = buildFXRateLookup(rows);
      const usdGbpRates = lookup.get('USD/GBP')!;

      expect(usdGbpRates[0].rate).toBeCloseTo(0.8, 2); // 1/1.25
    });

    it('should skip non-FX rows', () => {
      const rows: ProcessedIBKRRow[] = [
        createBuyRow('AAPL', 100, '2024-01-15', 'USD'),
        createFXTradeRow('GBP.USD', 1.25, '2024-01-15'),
      ];

      const lookup = buildFXRateLookup(rows);

      expect(lookup.has('AAPL')).toBe(false);
      expect(lookup.has('GBP/USD')).toBe(true);
    });

    it('should skip invalid FX rates (0 or negative)', () => {
      const rows: ProcessedIBKRRow[] = [
        createFXTradeRow('GBP.USD', 0, '2024-01-15'),
        createFXTradeRow('EUR.USD', -1.10, '2024-01-15'),
        createFXTradeRow('CHF.USD', 1.05, '2024-01-15'),
      ];

      const lookup = buildFXRateLookup(rows);

      expect(lookup.has('GBP/USD')).toBe(false);
      expect(lookup.has('EUR/USD')).toBe(false);
      expect(lookup.has('CHF/USD')).toBe(true);
    });

    it('should skip FX rates > 1000 (invalid)', () => {
      const rows: ProcessedIBKRRow[] = [
        createFXTradeRow('GBP.USD', 1001, '2024-01-15'),
        createFXTradeRow('EUR.USD', 1.10, '2024-01-15'),
      ];

      const lookup = buildFXRateLookup(rows);

      expect(lookup.has('GBP/USD')).toBe(false);
      expect(lookup.has('EUR/USD')).toBe(true);
    });
  });

  describe('Dividend Amount Calculation', () => {
    it('should calculate dividend using per-share × position when position available', async () => {
      // Setup: Account in GBP, dividend paid in USD
      const accountPreviews = [createAccountPreview('USD')];

      // Create position: Buy 100 shares before dividend
      const buyRow = createBuyRow('AAPL', 100, '2024-01-10', 'USD');
      buyRow.ListingExchange = 'NASDAQ';

      // Create dividend: $0.25 per share = $25 total
      const dividendRow = createDividendRow(
        'AAPL',
        25, // TradeMoney in base currency (would be same as dividend currency here)
        '2024-01-20',
        'Cash Dividend USD 0.25 per Share - US Tax',
        'USD'
      );

      const rows: ProcessedIBKRRow[] = [buyRow, dividendRow];
      const { activities } = await convertToActivityImports(rows, accountPreviews);

      const dividend = activities.find((a) => a.activityType === 'DIVIDEND');
      expect(dividend).toBeDefined();
      expect(dividend!.amount).toBe(25); // 100 shares × $0.25
      expect(dividend!.currency).toBe('USD');
    });

    it('should calculate dividend from per-share when currency differs from base', async () => {
      // Account base currency is GBP, dividend paid in USD
      const accountPreviews = [createAccountPreview('GBP'), createAccountPreview('USD')];

      // Create position: Buy 100 shares
      const buyRow = createBuyRow('AAPL', 100, '2024-01-10', 'GBP');
      buyRow.ListingExchange = 'NASDAQ';

      // Create dividend in USD (per-share info in description)
      // TradeMoney is in GBP (base currency) but actual dividend is in USD
      const dividendRow = createDividendRow(
        'AAPL',
        20, // TradeMoney in GBP (converted)
        '2024-01-20',
        'Cash Dividend USD 0.25 per Share - US Tax',
        'GBP' // Base currency
      );

      const rows: ProcessedIBKRRow[] = [buyRow, dividendRow];
      const { activities } = await convertToActivityImports(rows, accountPreviews);

      const dividend = activities.find((a) => a.activityType === 'DIVIDEND');
      expect(dividend).toBeDefined();
      // Should calculate: 100 shares × $0.25 = $25
      expect(dividend!.amount).toBe(25);
      expect(dividend!.currency).toBe('USD');
    });

    it('should fallback to FX conversion when position is 0', async () => {
      // No position (position = 0), but FX rate available
      const accountPreviews = [createAccountPreview('GBP'), createAccountPreview('USD')];

      // Create FX trade to provide rate lookup
      const fxRow = createFXTradeRow('GBP.USD', 1.25, '2024-01-15');

      // Create dividend without prior position
      const dividendRow = createDividendRow(
        'AAPL',
        20, // TradeMoney in GBP
        '2024-01-20',
        'Cash Dividend USD 0.50 per Share',
        'GBP'
      );

      const rows: ProcessedIBKRRow[] = [fxRow, dividendRow];
      const { activities } = await convertToActivityImports(rows, accountPreviews);

      const dividend = activities.find((a) => a.activityType === 'DIVIDEND');
      expect(dividend).toBeDefined();
      // Should use FX conversion: 20 GBP × 1.25 = 25 USD
      expect(dividend!.amount).toBe(25);
      expect(dividend!.currency).toBe('USD');
    });

    it('should use TradeMoney as-is when dividend currency matches base currency', async () => {
      const accountPreviews = [createAccountPreview('USD')];

      const dividendRow = createDividendRow(
        'AAPL',
        50.00,
        '2024-01-20',
        'Cash Dividend USD 0.50 per Share',
        'USD' // Same as dividend currency
      );

      const rows: ProcessedIBKRRow[] = [dividendRow];
      const { activities } = await convertToActivityImports(rows, accountPreviews);

      const dividend = activities.find((a) => a.activityType === 'DIVIDEND');
      expect(dividend).toBeDefined();
      expect(dividend!.amount).toBe(50);
      expect(dividend!.currency).toBe('USD');
    });

    it('should use TradeMoney as fallback when no FX rate and no position', async () => {
      // No position, no FX rate
      const accountPreviews = [createAccountPreview('GBP'), createAccountPreview('USD')];

      const dividendRow = createDividendRow(
        'AAPL',
        20, // TradeMoney in GBP
        '2024-01-20',
        'Cash Dividend USD 0.50 per Share',
        'GBP'
      );

      const rows: ProcessedIBKRRow[] = [dividendRow];
      const { activities } = await convertToActivityImports(rows, accountPreviews);

      const dividend = activities.find((a) => a.activityType === 'DIVIDEND');
      expect(dividend).toBeDefined();
      // Falls back to TradeMoney (20) in base currency
      expect(dividend!.amount).toBe(20);
      // Currency falls back to base currency (GBP) to match the amount
      // This is the correct behavior - amount and currency must be consistent
      expect(dividend!.currency).toBe('GBP');
    });
  });

  describe('Tax Amount Calculation', () => {
    it('should calculate tax amount using position and dividend info', async () => {
      // Setup: Position exists, tax on USD dividend
      const accountPreviews = [createAccountPreview('GBP'), createAccountPreview('USD')];

      // Create position: Buy 100 shares
      const buyRow = createBuyRow('AAPL', 100, '2024-01-10', 'GBP');
      buyRow.ListingExchange = 'NASDAQ';

      // Create FX trade for rate lookup
      const fxRow = createFXTradeRow('GBP.USD', 1.25, '2024-01-15');

      // Create tax row - 15% WHT on $25 dividend = $3.75
      const taxRow = createTaxRow(
        'AAPL',
        3.00, // TradeMoney in GBP (converted from ~$3.75)
        '2024-01-20',
        'AAPL(US0378331005) Cash Dividend USD 0.25 per Share - US Tax',
        'GBP'
      );

      const rows: ProcessedIBKRRow[] = [buyRow, fxRow, taxRow];
      const { activities } = await convertToActivityImports(rows, accountPreviews);

      const tax = activities.find((a) => a.activityType === 'TAX');
      expect(tax).toBeDefined();
      expect(tax!.currency).toBe('USD');
      // Tax amount should be calculated proportionally
      expect(tax!.amount).toBeGreaterThan(0);
    });

    it('should use FX conversion for tax when no position', async () => {
      const accountPreviews = [createAccountPreview('GBP'), createAccountPreview('USD')];

      // Create FX trade for rate lookup
      const fxRow = createFXTradeRow('GBP.USD', 1.25, '2024-01-15');

      // Create tax row without prior position
      const taxRow = createTaxRow(
        'AAPL',
        4.00, // TradeMoney in GBP
        '2024-01-20',
        'AAPL Cash Dividend USD 0.50 per Share - US Tax',
        'GBP'
      );

      const rows: ProcessedIBKRRow[] = [fxRow, taxRow];
      const { activities } = await convertToActivityImports(rows, accountPreviews);

      const tax = activities.find((a) => a.activityType === 'TAX');
      expect(tax).toBeDefined();
      // Should use FX conversion: 4 GBP × 1.25 = 5 USD
      expect(tax!.amount).toBe(5);
      expect(tax!.currency).toBe('USD');
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple FX rates and select closest by date', async () => {
      const accountPreviews = [createAccountPreview('GBP'), createAccountPreview('USD')];

      // Multiple FX rates on different dates
      const fxRow1 = createFXTradeRow('GBP.USD', 1.20, '2024-01-10');
      const fxRow2 = createFXTradeRow('GBP.USD', 1.25, '2024-01-15');
      const fxRow3 = createFXTradeRow('GBP.USD', 1.30, '2024-01-25');

      // Dividend on 2024-01-20 should use rate from 2024-01-15 (closest earlier date)
      const dividendRow = createDividendRow(
        'AAPL',
        20,
        '2024-01-20',
        'Cash Dividend USD 0.50 per Share',
        'GBP'
      );

      const rows: ProcessedIBKRRow[] = [fxRow1, fxRow2, fxRow3, dividendRow];
      const { activities } = await convertToActivityImports(rows, accountPreviews);

      const dividend = activities.find((a) => a.activityType === 'DIVIDEND');
      expect(dividend).toBeDefined();
      // Should use rate 1.25 (closest earlier date): 20 × 1.25 = 25
      expect(dividend!.amount).toBe(25);
    });

    it('should handle dividend without currency in description', async () => {
      const accountPreviews = [createAccountPreview('USD')];

      const dividendRow = createDividendRow(
        'AAPL',
        50.00,
        '2024-01-20',
        'Dividend Payment', // No currency info
        'USD'
      );

      const rows: ProcessedIBKRRow[] = [dividendRow];
      const { activities } = await convertToActivityImports(rows, accountPreviews);

      const dividend = activities.find((a) => a.activityType === 'DIVIDEND');
      expect(dividend).toBeDefined();
      // Should fall back to using TradeMoney as-is with base currency
      expect(dividend!.amount).toBe(50);
      expect(dividend!.currency).toBe('USD');
    });

    it('should handle position building across multiple buy/sell', async () => {
      const accountPreviews = [createAccountPreview('USD')];

      // Buy 100, sell 30, buy 50 = 120 position
      const buy1 = createBuyRow('AAPL', 100, '2024-01-05', 'USD');
      buy1.ListingExchange = 'NASDAQ';

      const sell1: ProcessedIBKRRow = {
        ...createBuyRow('AAPL', 30, '2024-01-10', 'USD'),
        _IBKR_TYPE: 'IBKR_SELL',
      };

      const buy2 = createBuyRow('AAPL', 50, '2024-01-15', 'USD');
      buy2.ListingExchange = 'NASDAQ';

      // Dividend at $0.25 per share on 120 shares = $30
      const dividendRow = createDividendRow(
        'AAPL',
        30,
        '2024-01-20',
        'Cash Dividend USD 0.25 per Share',
        'USD'
      );

      const rows: ProcessedIBKRRow[] = [buy1, sell1, buy2, dividendRow];
      const { activities } = await convertToActivityImports(rows, accountPreviews);

      const dividend = activities.find((a) => a.activityType === 'DIVIDEND');
      expect(dividend).toBeDefined();
      // Position: 100 - 30 + 50 = 120; Dividend: 120 × 0.25 = 30
      expect(dividend!.amount).toBe(30);
    });
  });
});

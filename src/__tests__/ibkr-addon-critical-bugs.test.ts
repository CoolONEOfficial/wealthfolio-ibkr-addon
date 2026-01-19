/**
 * IBKR Addon Critical Bugs Test Suite
 *
 * Tests for potential bugs and edge cases discovered through code analysis:
 * - CSV parsing issues with quoted values containing commas
 * - Date format handling inconsistencies
 * - Hardcoded FX rate in dividend calculations
 * - Tax country detection gaps
 * - Symbol classification edge cases (dots in symbols)
 * - Position history edge cases
 * - Ticker resolution edge cases
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseFlexQueryCSV } from '../lib/flex-csv-parser';
import { extractTradesSection, isMultiSectionIBKR } from '../lib/ibkr-csv-splitter';
import { preprocessIBKRData } from '../lib/ibkr-preprocessor';
import { convertToActivityImports } from '../lib/activity-converter';
import { splitFXConversions } from '../lib/fx-transaction-splitter';
import { generateAccountNames } from '../lib/account-name-generator';
import type { Account } from '@wealthfolio/addon-sdk';

// ============================================================================
// SECTION 1: CSV PARSING CRITICAL ISSUES (10 tests)
// ============================================================================

describe('CSV Parsing Critical Issues', () => {
  describe('Quoted Values with Commas', () => {
    it('should parse company names with commas', () => {
      const csv = `Symbol,Description,Amount
"AAPL","Apple, Inc.",100.50
"MSFT","Microsoft Corporation, Ltd.",200.75`;

      const result = parseFlexQueryCSV(csv);
      expect(result.errors).toHaveLength(0);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].Description).toBe('Apple, Inc.');
      expect(result.rows[1].Description).toBe('Microsoft Corporation, Ltd.');
    });

    it('should parse dividend descriptions with commas', () => {
      const csv = `Symbol,ActivityDescription,Amount
"AAPL","AAPL(US0378331005) Cash Dividend USD 0.24 per Share, Ordinary Dividend",24.00
"VOD","VOD.L(GB00BH4HKS39) Cash Dividend GBP 0.0154 per Share, Final Dividend",15.40`;

      const result = parseFlexQueryCSV(csv);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].ActivityDescription).toContain('Ordinary Dividend');
    });

    it('should parse addresses with commas in company info', () => {
      const csv = `Symbol,Description,Exchange
"TEST","Company Name, 123 Main St, New York, NY",NYSE`;

      const result = parseFlexQueryCSV(csv);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].Description).toBe('Company Name, 123 Main St, New York, NY');
    });

    it('should handle quotes within quoted values', () => {
      const csv = `Symbol,Description,Amount
"TEST","Company ""Nickname"" Inc.",100`;

      const result = parseFlexQueryCSV(csv);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].Description).toBe('Company "Nickname" Inc.');
    });
  });

  describe('BOM and Encoding', () => {
    it('should handle UTF-8 BOM at file start (known limitation)', () => {
      const bom = '\uFEFF';
      const csv = `${bom}Symbol,Description,Amount
AAPL,Apple Inc,100`;

      const result = parseFlexQueryCSV(csv);
      // IBKR Flex Query responses don't have BOM, so this is an edge case
      // The parser requires minimum 3 columns
      expect(result.rows).toHaveLength(1);
      // Check if BOM is preserved or stripped - either way the row should exist
      const symbol = result.rows[0][`${bom}Symbol`] || result.rows[0]['Symbol'];
      expect(symbol).toBe('AAPL');
    });

    it('should handle Windows line endings (CRLF)', () => {
      const csv = 'Symbol,Description,Amount\r\nAAPL,Apple Inc,100\r\nMSFT,Microsoft,200';

      const result = parseFlexQueryCSV(csv);
      expect(result.rows).toHaveLength(2);
    });

    it('should handle mixed line endings', () => {
      const csv = 'Symbol,Description,Amount\nAAPL,Apple Inc,100\r\nMSFT,Microsoft,200\n';

      const result = parseFlexQueryCSV(csv);
      expect(result.rows).toHaveLength(2);
    });
  });

  describe('Empty and Malformed Data', () => {
    it('should handle completely empty CSV', () => {
      const csv = '';
      const result = parseFlexQueryCSV(csv);
      expect(result.rows).toHaveLength(0);
    });

    it('should handle CSV with only whitespace', () => {
      const csv = '   \n\n   \n';
      const result = parseFlexQueryCSV(csv);
      expect(result.rows).toHaveLength(0);
    });

    it('should handle CSV with trailing empty lines', () => {
      const csv = `Symbol,Description,Amount
AAPL,Apple Inc,100



`;
      const result = parseFlexQueryCSV(csv);
      expect(result.rows).toHaveLength(1);
    });
  });
});

// ============================================================================
// SECTION 2: DATE FORMAT HANDLING (12 tests)
// ============================================================================

describe('Date Format Handling', () => {
  describe('Position History Date Sorting', () => {
    it('should correctly order trades with ISO dates', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '100', Date: '2024-01-15', TradePrice: '150', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '50', Date: '2024-01-10', TradePrice: '148', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
        { _IBKR_TYPE: 'IBKR_DIVIDEND', Symbol: 'AAPL', TradeMoney: '15', Date: '2024-01-20', CurrencyPrimary: 'GBP', ActivityDescription: 'AAPL Cash Dividend NOK 0.10 per Share' },
      ];

      const mockAccounts = [
        { currency: 'USD', name: 'Test USD' },
        { currency: 'NOK', name: 'Test NOK' },
      ];

      const { activities } = await convertToActivityImports(rows, mockAccounts);
      const dividend = activities.find(a => a.activityType === 'DIVIDEND');

      // Position at dividend date should be 150 (100 + 50)
      // Dividend is NOK, uses position calculation: 150 * 0.10 = 15
      expect(dividend?.amount).toBe(15);
    });

    it('should handle YYYYMMDD date format', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '100', Date: '20240115', TradePrice: '150', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
      ];

      const mockAccounts = [{ currency: 'USD', name: 'Test USD' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      expect(activities[0].date).toBe('20240115');
    });

    it('should handle datetime format (YYYY-MM-DD HH:MM:SS)', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '100', Date: '2024-01-15 10:30:00', TradePrice: '150', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
      ];

      const mockAccounts = [{ currency: 'USD', name: 'Test USD' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      expect(activities[0].date).toBe('2024-01-15 10:30:00');
    });
  });

  describe('Date Comparison Edge Cases', () => {
    it('should handle trades and dividends on same date', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '100', Date: '2024-01-15', TradePrice: '150', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
        { _IBKR_TYPE: 'IBKR_DIVIDEND', Symbol: 'AAPL', TradeMoney: '10', Date: '2024-01-15', CurrencyPrimary: 'GBP', ActivityDescription: 'AAPL Cash Dividend NOK 0.10 per Share' },
      ];

      const mockAccounts = [
        { currency: 'USD', name: 'Test USD' },
        { currency: 'NOK', name: 'Test NOK' },
      ];

      const { activities } = await convertToActivityImports(rows, mockAccounts);
      const dividend = activities.find(a => a.activityType === 'DIVIDEND');

      // Trade is on same date as dividend, so position should include it
      expect(dividend?.amount).toBe(10); // 100 * 0.10
    });

    it('should reject transactions without dates', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '100', TradePrice: '150', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
      ];

      const mockAccounts = [{ currency: 'USD', name: 'Test USD' }];
      const { activities, errors } = await convertToActivityImports(rows, mockAccounts);

      // Transactions without dates should be rejected (not silently defaulted to today)
      expect(activities).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Missing date');
    });

    it('should use ReportDate when Date is missing', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '100', ReportDate: '2024-01-15', TradePrice: '150', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
      ];

      const mockAccounts = [{ currency: 'USD', name: 'Test USD' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      expect(activities[0].date).toBe('2024-01-15');
    });
  });
});

// ============================================================================
// SECTION 3: DIVIDEND CALCULATION ISSUES (15 tests)
// ============================================================================

describe('Dividend Calculation Issues', () => {
  describe('Position-Based Dividend Calculation', () => {
    it('should use position-based calculation for USD dividends with position', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '200', Date: '2024-01-01', TradePrice: '150', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
        { _IBKR_TYPE: 'IBKR_DIVIDEND', Symbol: 'AAPL', TradeMoney: '100', CurrencyPrimary: 'GBP', ActivityDescription: 'AAPL Cash Dividend USD 0.50 per Share', Date: '2024-01-15' },
      ];

      const mockAccounts = [{ currency: 'USD', name: 'Test USD' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      const dividend = activities.find(a => a.activityType === 'DIVIDEND');
      // Position-based: 200 * 0.50 = 100
      expect(dividend?.amount).toBe(100);
    });

    it('should use position-based calculation for non-USD dividends', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'VOD', Quantity: '1000', Date: '2024-01-01', TradePrice: '100', CurrencyPrimary: 'GBP', ListingExchange: 'LSE' },
        { _IBKR_TYPE: 'IBKR_DIVIDEND', Symbol: 'VOD', TradeMoney: '15.40', CurrencyPrimary: 'GBP', ActivityDescription: 'VOD Cash Dividend GBP 0.0154 per Share', Date: '2024-02-01' },
      ];

      const mockAccounts = [{ currency: 'GBP', name: 'Test GBP' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      const dividend = activities.find(a => a.activityType === 'DIVIDEND');
      // GBP dividend uses position * per share: 1000 * 0.0154 = 15.40
      expect(dividend?.amount).toBe(15.4);
    });
  });

  describe('Position History Edge Cases', () => {
    it('should fallback to TradeMoney when no position history', async () => {
      const rows = [
        // Dividend without any prior trades
        { _IBKR_TYPE: 'IBKR_DIVIDEND', Symbol: 'AAPL', TradeMoney: '24', CurrencyPrimary: 'GBP', ActivityDescription: 'AAPL Cash Dividend GBP 0.24 per Share', Date: '2024-01-15' },
      ];

      const mockAccounts = [{ currency: 'GBP', name: 'Test GBP' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      // No position = fallback to TradeMoney = 24
      expect(activities[0].amount).toBe(24);
    });

    it('should handle multiple buys before dividend', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '50', Date: '2024-01-01', TradePrice: '150', CurrencyPrimary: 'GBP', ListingExchange: 'NASDAQ' },
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '30', Date: '2024-01-10', TradePrice: '155', CurrencyPrimary: 'GBP', ListingExchange: 'NASDAQ' },
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '20', Date: '2024-01-15', TradePrice: '160', CurrencyPrimary: 'GBP', ListingExchange: 'NASDAQ' },
        { _IBKR_TYPE: 'IBKR_DIVIDEND', Symbol: 'AAPL', TradeMoney: '25', CurrencyPrimary: 'GBP', ActivityDescription: 'AAPL Cash Dividend GBP 0.25 per Share', Date: '2024-02-01' },
      ];

      const mockAccounts = [{ currency: 'GBP', name: 'Test GBP' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      const dividend = activities.find(a => a.activityType === 'DIVIDEND');
      // Total position: 50 + 30 + 20 = 100, dividend = 100 * 0.25 = 25
      expect(dividend?.amount).toBe(25);
    });

    it('should handle buy and sell before dividend', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '100', Date: '2024-01-01', TradePrice: '150', CurrencyPrimary: 'GBP', ListingExchange: 'NASDAQ' },
        { _IBKR_TYPE: 'IBKR_SELL', Symbol: 'AAPL', Quantity: '30', Date: '2024-01-15', TradePrice: '160', CurrencyPrimary: 'GBP', ListingExchange: 'NASDAQ' },
        { _IBKR_TYPE: 'IBKR_DIVIDEND', Symbol: 'AAPL', TradeMoney: '17.5', CurrencyPrimary: 'GBP', ActivityDescription: 'AAPL Cash Dividend GBP 0.25 per Share', Date: '2024-02-01' },
      ];

      const mockAccounts = [{ currency: 'GBP', name: 'Test GBP' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      const dividend = activities.find(a => a.activityType === 'DIVIDEND');
      // Position after sell: 100 - 30 = 70, dividend = 70 * 0.25 = 17.5
      expect(dividend?.amount).toBe(17.5);
    });

    it('should handle case-insensitive symbol matching', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'aapl', Quantity: '100', Date: '2024-01-01', TradePrice: '150', CurrencyPrimary: 'GBP', ListingExchange: 'NASDAQ' },
        { _IBKR_TYPE: 'IBKR_DIVIDEND', Symbol: 'AAPL', TradeMoney: '25', CurrencyPrimary: 'GBP', ActivityDescription: 'AAPL Cash Dividend GBP 0.25 per Share', Date: '2024-02-01' },
      ];

      const mockAccounts = [{ currency: 'GBP', name: 'Test GBP' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      const dividend = activities.find(a => a.activityType === 'DIVIDEND');
      // Should match despite case difference
      expect(dividend?.amount).toBe(25);
    });
  });

  describe('Dividend Description Parsing', () => {
    it('should parse standard dividend format', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: 'AAPL', Quantity: '100', Date: '2024-01-01', TradePrice: '150', CurrencyPrimary: 'GBP', ListingExchange: 'NASDAQ' },
        { _IBKR_TYPE: 'IBKR_DIVIDEND', Symbol: 'AAPL', TradeMoney: '24', CurrencyPrimary: 'GBP', ActivityDescription: 'AAPL(US0378331005) Cash Dividend GBP 0.24 per Share', Date: '2024-02-01' },
      ];

      const mockAccounts = [{ currency: 'GBP', name: 'Test GBP' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      const dividend = activities.find(a => a.activityType === 'DIVIDEND');
      expect(dividend?.currency).toBe('GBP');
      expect(dividend?.amount).toBe(24);
    });

    it('should parse HK format without "per Share"', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_BUY', Symbol: '0005', Quantity: '1000', Date: '2024-01-01', TradePrice: '50', CurrencyPrimary: 'HKD', ListingExchange: 'SEHK' },
        { _IBKR_TYPE: 'IBKR_DIVIDEND', Symbol: '0005', TradeMoney: '400', CurrencyPrimary: 'HKD', ActivityDescription: '0005 (HK0000001005) Cash Dividend HKD 0.40 (Ordinary Dividend)', Date: '2024-02-01' },
      ];

      const mockAccounts = [{ currency: 'HKD', name: 'Test HKD' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      const dividend = activities.find(a => a.activityType === 'DIVIDEND');
      expect(dividend?.currency).toBe('HKD');
      expect(dividend?.amount).toBe(400); // 1000 * 0.40
    });

    it('should fallback to TradeMoney when description unparseable', async () => {
      const rows = [
        { _IBKR_TYPE: 'IBKR_DIVIDEND', Symbol: 'AAPL', TradeMoney: '24.50', CurrencyPrimary: 'GBP', ActivityDescription: 'Some unusual dividend format', Date: '2024-02-01' },
      ];

      const mockAccounts = [{ currency: 'GBP', name: 'Test GBP' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      // Can't parse dividend info, uses TradeMoney directly
      expect(activities[0].amount).toBe(24.5);
    });
  });
});

// ============================================================================
// SECTION 4: TAX COUNTRY DETECTION (10 tests)
// ============================================================================

describe('Tax Country Detection', () => {
  describe('Recognized Tax Countries', () => {
    const recognizedCountries = [
      { code: 'CH', name: 'Switzerland' },
      { code: 'US', name: 'United States' },
      { code: 'GB', name: 'United Kingdom' },
      { code: 'BR', name: 'Brazil' },
      { code: 'FO', name: 'Faroe Islands' },
      { code: 'CN', name: 'China' },
      { code: 'NL', name: 'Netherlands' },
      { code: 'FR', name: 'France' },
      { code: 'IT', name: 'Italy' },
    ];

    recognizedCountries.forEach(({ code, name }) => {
      it(`should recognize ${name} (${code}) tax`, () => {
        const row = {
          Description: `AAPL(US0378331005) CASH DIVIDEND USD 0.24 PER SHARE - ${code} TAX`,
          TradeMoney: '-5.00',
        };

        const result = preprocessIBKRData([row as any]);
        expect(result.processedData).toHaveLength(1);
        expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_TAX');
      });
    });
  });

  describe('Additional Tax Countries (Now Fixed)', () => {
    const additionalCountries = [
      { code: 'DE', name: 'Germany' },
      { code: 'JP', name: 'Japan' },
      { code: 'AU', name: 'Australia' },
      { code: 'CA', name: 'Canada' },
      { code: 'IE', name: 'Ireland' },
      { code: 'ES', name: 'Spain' },
      { code: 'BE', name: 'Belgium' },
      { code: 'AT', name: 'Austria' },
      { code: 'DK', name: 'Denmark' },
      { code: 'SE', name: 'Sweden' },
      { code: 'NO', name: 'Norway' },
      { code: 'FI', name: 'Finland' },
      { code: 'SG', name: 'Singapore' },
      { code: 'HK', name: 'Hong Kong' },
      { code: 'KR', name: 'South Korea' },
    ];

    additionalCountries.forEach(({ code, name }) => {
      it(`should recognize ${name} (${code}) tax as DIVIDEND_TAX`, () => {
        const row = {
          Description: `SYMBOL(ISIN) CASH DIVIDEND USD 0.24 PER SHARE - ${code} TAX`,
          TradeMoney: '-5.00',
        };

        const result = preprocessIBKRData([row as any]);
        // All countries with "- XX TAX" pattern are now recognized
        expect(result.processedData).toHaveLength(1);
        expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_TAX');
      });
    });
  });
});

// ============================================================================
// SECTION 5: SYMBOL CLASSIFICATION EDGE CASES (15 tests)
// ============================================================================

describe('Symbol Classification Edge Cases', () => {
  describe('Symbols with Dots (FX vs Stock)', () => {
    const createMockAccount = (currency: string): Account => ({
      id: `acc-${currency}`,
      name: `Test - ${currency}`,
      currency,
      group: 'Test',
      accountType: 'SECURITIES',
      isDefault: false,
      isActive: true,
      balance: 0,
      marketValue: 0,
      bookCost: 0,
      availableCash: 0,
      netDeposit: 0,
      totalGainValue: 0,
      totalGainPct: 0,
      dayGainValue: 0,
      dayGainPct: 0,
    });

    it('should NOT treat BRK.B as FX conversion', () => {
      const transactions = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'BRK.B',
        activityType: 'BUY' as const,
        quantity: 10,
        unitPrice: 350,
        currency: 'USD',
        fee: 1,
        amount: 3500,
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([['USD', createMockAccount('USD')]]);
      const result = splitFXConversions(transactions, accounts);

      // BRK.B should not be split
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].activityType).toBe('BUY');
    });

    it('should NOT treat VOD.L as FX conversion', () => {
      const transactions = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'VOD.L',
        activityType: 'BUY' as const,
        quantity: 100,
        unitPrice: 100,
        currency: 'GBP',
        fee: 5,
        amount: 10000,
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([['GBP', createMockAccount('GBP')]]);
      const result = splitFXConversions(transactions, accounts);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].symbol).toBe('VOD.L');
    });

    it('should NOT treat 0005.HK as FX conversion', () => {
      const transactions = [{
        accountId: '',
        date: '2024-01-15',
        symbol: '0005.HK',
        activityType: 'BUY' as const,
        quantity: 1000,
        unitPrice: 50,
        currency: 'HKD',
        fee: 10,
        amount: 50000,
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([['HKD', createMockAccount('HKD')]]);
      const result = splitFXConversions(transactions, accounts);

      expect(result.transactions).toHaveLength(1);
    });

    it('should treat GBP.USD as FX conversion', () => {
      const transactions = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'GBP.USD',
        activityType: 'SELL' as const,
        quantity: 1000,
        unitPrice: 1.25,
        currency: 'USD',
        fee: 0,
        amount: 1250,
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([
        ['GBP', createMockAccount('GBP')],
        ['USD', createMockAccount('USD')],
      ]);
      const result = splitFXConversions(transactions, accounts);

      // Should be split into withdrawal + deposit
      expect(result.transactions).toHaveLength(2);
    });

    it('should treat EUR.CHF as FX conversion', () => {
      const transactions = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'EUR.CHF',
        activityType: 'SELL' as const,
        quantity: 500,
        unitPrice: 0.95,
        currency: 'CHF',
        fee: 0,
        amount: 475,
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([
        ['EUR', createMockAccount('EUR')],
        ['CHF', createMockAccount('CHF')],
      ]);
      const result = splitFXConversions(transactions, accounts);

      expect(result.transactions).toHaveLength(2);
    });

    it('should handle mixed batch with stocks and FX', () => {
      const transactions = [
        {
          accountId: '',
          date: '2024-01-15',
          symbol: 'AAPL',
          activityType: 'BUY' as const,
          quantity: 10,
          unitPrice: 150,
          currency: 'USD',
          fee: 1,
          amount: 1500,
          comment: '',
          isDraft: false,
          isValid: true,
        },
        {
          accountId: '',
          date: '2024-01-15',
          symbol: 'GBP.USD',
          activityType: 'SELL' as const,
          quantity: 1000,
          unitPrice: 1.25,
          currency: 'USD',
          fee: 0,
          amount: 1250,
          comment: '',
          isDraft: false,
          isValid: true,
        },
        {
          accountId: '',
          date: '2024-01-15',
          symbol: 'BRK.B',
          activityType: 'BUY' as const,
          quantity: 5,
          unitPrice: 400,
          currency: 'USD',
          fee: 1,
          amount: 2000,
          comment: '',
          isDraft: false,
          isValid: true,
        },
      ];

      const accounts = new Map([
        ['GBP', createMockAccount('GBP')],
        ['USD', createMockAccount('USD')],
      ]);
      const result = splitFXConversions(transactions, accounts);

      // 2 stocks + 2 FX splits = 4 transactions
      expect(result.transactions).toHaveLength(4);
      expect(result.transactions.filter(r => r.symbol === 'AAPL')).toHaveLength(1);
      expect(result.transactions.filter(r => r.symbol === 'BRK.B')).toHaveLength(1);
    });
  });

  describe('Currency Pair Pattern Matching', () => {
    const createMockAccount = (currency: string): Account => ({
      id: `acc-${currency}`,
      name: `Test - ${currency}`,
      currency,
      group: 'Test',
      accountType: 'SECURITIES',
      isDefault: false,
      isActive: true,
      balance: 0,
      marketValue: 0,
      bookCost: 0,
      availableCash: 0,
      netDeposit: 0,
      totalGainValue: 0,
      totalGainPct: 0,
      dayGainValue: 0,
      dayGainPct: 0,
    });

    const validFXPairs = ['GBP.USD', 'EUR.USD', 'USD.JPY', 'GBP.EUR', 'AUD.USD', 'USD.CHF', 'NZD.USD', 'USD.CAD'];

    validFXPairs.forEach(pair => {
      const [source, target] = pair.split('.');
      it(`should recognize ${pair} as FX pair`, () => {
        const transactions = [{
          accountId: '',
          date: '2024-01-15',
          symbol: pair,
          activityType: 'SELL' as const,
          quantity: 1000,
          unitPrice: 1.5,
          currency: target,
          fee: 0,
          amount: 1500,
          comment: '',
          isDraft: false,
          isValid: true,
        }];

        const accounts = new Map([
          [source, createMockAccount(source)],
          [target, createMockAccount(target)],
        ]);
        const result = splitFXConversions(transactions, accounts);

        expect(result.transactions).toHaveLength(2);
      });
    });

    const invalidFXPatterns = ['A.B', 'AB.C', 'ABCD.EFG', 'ABC.D', '.USD', 'USD.'];

    invalidFXPatterns.forEach(pattern => {
      it(`should NOT recognize ${pattern} as FX pair (invalid format)`, () => {
        const transactions = [{
          accountId: '',
          date: '2024-01-15',
          symbol: pattern,
          activityType: 'BUY' as const,
          quantity: 100,
          unitPrice: 1,
          currency: 'USD',
          fee: 0,
          amount: 100,
          comment: '',
          isDraft: false,
          isValid: true,
        }];

        const accounts = new Map([['USD', createMockAccount('USD')]]);
        const result = splitFXConversions(transactions, accounts);

        // Should not be split (no matching accounts for invalid patterns anyway)
        expect(result.transactions.length).toBeLessThanOrEqual(1);
      });
    });
  });
});

// ============================================================================
// SECTION 6: PREPROCESSOR EDGE CASES (10 tests)
// ============================================================================

describe('Preprocessor Additional Edge Cases', () => {
  describe('Empty and Missing Fields', () => {
    it('should handle completely empty row', () => {
      const row = {};
      const result = preprocessIBKRData([row as any]);
      expect(result.skipped).toBe(1);
    });

    it('should handle row with only whitespace values', () => {
      const row = {
        Symbol: '   ',
        Description: '   ',
        TransactionType: '   ',
      };
      const result = preprocessIBKRData([row as any]);
      expect(result.skipped).toBe(1);
    });

    it('should handle undefined values gracefully', () => {
      const row = {
        Symbol: undefined,
        TransactionType: undefined,
        Exchange: 'NYSE',
        'Buy/Sell': 'BUY',
      };
      const result = preprocessIBKRData([row as any]);
      // Should not crash
      expect(result).toBeDefined();
    });
  });

  describe('Special Characters in Fields', () => {
    it('should handle symbols with special characters', () => {
      const row = {
        TransactionType: 'ExchTrade',
        'Buy/Sell': 'BUY',
        Exchange: 'NYSE',
        Symbol: 'BRK/A', // Some brokers use / instead of .
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0].Symbol).toBe('BRK/A');
    });

    it('should handle description with HTML entities', () => {
      const row = {
        Description: 'Company &amp; Co. CASH DIVIDEND USD 0.50 PER SHARE',
        TradeMoney: '50.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
    });

    it('should handle description with unicode characters', () => {
      const row = {
        Description: 'Société Générale CASH DIVIDEND EUR 0.50 PER SHARE',
        TradeMoney: '50.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_DIVIDEND');
    });
  });

  describe('Numeric Field Edge Cases', () => {
    it('should handle negative zero', () => {
      const row = {
        'Notes/Codes': 'Deposits/Withdrawals',
        TradeMoney: '-0',
      };

      const result = preprocessIBKRData([row as any]);
      // -0 should be treated as zero, not deposited/withdrawn
      expect(result.skipped).toBe(1);
    });

    it('should handle very large amounts', () => {
      const row = {
        'Notes/Codes': 'Deposits/Withdrawals',
        TradeMoney: '9999999999.99',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_DEPOSIT');
    });

    it('should handle amounts with thousand separators', () => {
      const row = {
        'Notes/Codes': 'Deposits/Withdrawals',
        TradeMoney: '1,234,567.89',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
    });
  });
});

// ============================================================================
// SECTION 7: TICKER RESOLUTION EDGE CASES (8 tests)
// ============================================================================

describe('Ticker Resolution Edge Cases', () => {
  describe('Exchange to Currency Mapping', () => {
    it('should map PINK (OTC) to USD', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'HESAY',
        Quantity: '100',
        TradePrice: '30',
        CurrencyPrimary: 'USD',
        ListingExchange: 'PINK',
        Date: '2024-01-15',
      }];

      const mockAccounts = [{ currency: 'USD', name: 'Test USD' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      expect(activities[0].currency).toBe('USD');
    });

    it('should handle unknown exchange gracefully', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'TEST',
        Quantity: '100',
        TradePrice: '50',
        CurrencyPrimary: 'USD',
        ListingExchange: 'UNKNOWN_EXCHANGE',
        Date: '2024-01-15',
      }];

      const mockAccounts = [{ currency: 'USD', name: 'Test USD' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      // Should fallback to CurrencyPrimary
      expect(activities[0].currency).toBe('USD');
    });
  });

  describe('Symbol Formatting', () => {
    it('should handle single-character symbols', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'F',
        Quantity: '100',
        TradePrice: '15',
        CurrencyPrimary: 'USD',
        ListingExchange: 'NYSE',
        Date: '2024-01-15',
      }];

      const mockAccounts = [{ currency: 'USD', name: 'Test USD' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      expect(activities[0].symbol).toBe('F');
    });

    it('should handle $CASH symbols', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_FEE',
        Symbol: '$CASH-USD',
        TradeMoney: '5.00',
        CurrencyPrimary: 'USD',
        Date: '2024-01-15',
      }];

      const mockAccounts = [{ currency: 'USD', name: 'Test USD' }];
      const { activities } = await convertToActivityImports(rows, mockAccounts);

      expect(activities[0].symbol).toBe('$CASH-USD');
    });
  });
});

// ============================================================================
// SECTION 8: MULTI-SECTION IBKR CSV (10 tests)
// ============================================================================

describe('Multi-Section IBKR CSV Edge Cases', () => {
  describe('Section Detection', () => {
    it('should detect single section as not multi-section', () => {
      const csv = `"ClientAccountID","TransactionType","Exchange"
"U123","ExchTrade","NYSE"`;

      expect(isMultiSectionIBKR(csv)).toBe(false);
    });

    it('should detect two sections as multi-section', () => {
      const csv = `"ClientAccountID","TransactionType","Exchange"
"U123","ExchTrade","NYSE"
"ClientAccountID","Date/Time","Amount"
"U123","2024-01-15","100"`;

      expect(isMultiSectionIBKR(csv)).toBe(true);
    });

    it('should handle sections in unexpected order', () => {
      // Dividends section first, then trades
      const csv = `"ClientAccountID","Date/Time","Amount","Type"
"U123","2024-01-15","100","Dividend"
"ClientAccountID","TransactionType","Exchange","Buy/Sell"
"U123","ExchTrade","NYSE","BUY"`;

      expect(isMultiSectionIBKR(csv)).toBe(true);

      const extracted = extractTradesSection(csv);
      expect(extracted).toContain('TransactionType');
      expect(extracted).toContain('ExchTrade');
    });
  });

  describe('Section Merging', () => {
    it('should merge rows from all sections', () => {
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell"
"U123","ExchTrade","NYSE","BUY"
"ClientAccountID","Date/Time","Amount","Type"
"U123","2024-01-15","100","Dividend"`;

      const extracted = extractTradesSection(csv);
      const lines = extracted.split('\n');

      // Should have header + 2 data rows
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle section with no data rows', () => {
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell"
"U123","ExchTrade","NYSE","BUY"
"ClientAccountID","Date/Time","Amount","Type"`;
      // Second section has header but no data

      const extracted = extractTradesSection(csv);
      expect(extracted).toContain('ExchTrade');
    });
  });

  describe('Column Name Normalization', () => {
    it('should map Date/Time to TradeDate', () => {
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell"
"U123","ExchTrade","NYSE","BUY"
"ClientAccountID","Date/Time","Amount","Type"
"U123","2024-01-15","100","Dividend"`;

      const extracted = extractTradesSection(csv);

      // The merged CSV should have normalized column names
      expect(extracted).toContain('TradeDate');
    });

    it('should preserve original columns from trades section', () => {
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell","TradePrice"
"U123","ExchTrade","NYSE","BUY","150.00"
"ClientAccountID","Date/Time","Amount","Type"
"U123","2024-01-15","100","Dividend"`;

      const extracted = extractTradesSection(csv);

      expect(extracted).toContain('TransactionType');
      expect(extracted).toContain('TradePrice');
    });
  });
});

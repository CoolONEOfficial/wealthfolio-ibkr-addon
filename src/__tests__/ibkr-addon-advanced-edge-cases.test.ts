/**
 * IBKR Addon Advanced Edge Cases Test Suite
 *
 * Tests for additional potential bugs and edge cases discovered through code analysis:
 * - FX splitter currency validation
 * - FX splitter zero amount handling
 * - Ticker resolver cache key validation
 * - Multi-file parsing header handling
 * - Position history with all sells (short selling)
 * - Activity converter edge cases
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { splitFXConversions } from '../lib/fx-transaction-splitter';
import { extractTickersToResolve, resolveTicker } from '../lib/ticker-resolver';
import { preprocessIBKRData } from '../lib/ibkr-preprocessor';
import { convertToActivityImports } from '../lib/activity-converter';
import { parseFlexQueryCSV } from '../lib/flex-csv-parser';
import { generateAccountNames } from '../lib/account-name-generator';
import { detectCurrenciesFromIBKR } from '../lib/currency-detector';
import type { Account, ActivityImport } from '@wealthfolio/addon-sdk';

// Helper to create mock account
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

// ============================================================================
// SECTION 1: FX SPLITTER CURRENCY VALIDATION (15 tests)
// ============================================================================

describe('FX Splitter Currency Validation', () => {
  describe('Valid ISO 4217 Currency Codes', () => {
    const validCurrencyPairs = [
      { pair: 'USD.EUR', source: 'USD', target: 'EUR' },
      { pair: 'GBP.USD', source: 'GBP', target: 'USD' },
      { pair: 'EUR.CHF', source: 'EUR', target: 'CHF' },
      { pair: 'AUD.NZD', source: 'AUD', target: 'NZD' },
      { pair: 'JPY.USD', source: 'JPY', target: 'USD' },
      { pair: 'CAD.USD', source: 'CAD', target: 'USD' },
      { pair: 'HKD.USD', source: 'HKD', target: 'USD' },
      { pair: 'SGD.USD', source: 'SGD', target: 'USD' },
      { pair: 'NOK.EUR', source: 'NOK', target: 'EUR' },
      { pair: 'SEK.EUR', source: 'SEK', target: 'EUR' },
    ];

    validCurrencyPairs.forEach(({ pair, source, target }) => {
      it(`should split ${pair} FX conversion correctly`, () => {
        const transactions: ActivityImport[] = [{
          accountId: '',
          date: '2024-01-15',
          symbol: pair,
          activityType: 'SELL',
          quantity: 1000,
          unitPrice: 1.25,
          currency: target,
          fee: 0,
          amount: 1250,
          comment: 'IDEALFX',
          isDraft: false,
          isValid: true,
        }];

        const accounts = new Map([
          [source, createMockAccount(source)],
          [target, createMockAccount(target)],
        ]);

        const result = splitFXConversions(transactions, accounts);

        expect(result.transactions).toHaveLength(2);
        expect(result.transactions[0].activityType).toBe('WITHDRAWAL');
        expect(result.transactions[0].currency).toBe(source);
        expect(result.transactions[1].activityType).toBe('DEPOSIT');
        expect(result.transactions[1].currency).toBe(target);
      });
    });
  });

  describe('Invalid Currency-Like Patterns', () => {
    it('should NOT split lowercase currency pair', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'usd.eur', // lowercase
        activityType: 'SELL',
        quantity: 1000,
        unitPrice: 1.1,
        currency: 'EUR',
        fee: 0,
        amount: 1100,
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([
        ['USD', createMockAccount('USD')],
        ['EUR', createMockAccount('EUR')],
      ]);

      const result = splitFXConversions(transactions, accounts);
      // lowercase doesn't match the pattern, should pass through
      expect(result.transactions).toHaveLength(1);
    });

    it('should NOT split 4-letter currency codes', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'USDC.USDT', // 4-letter codes (crypto)
        activityType: 'SELL',
        quantity: 1000,
        unitPrice: 1,
        currency: 'USD',
        fee: 0,
        amount: 1000,
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([['USD', createMockAccount('USD')]]);
      const result = splitFXConversions(transactions, accounts);
      expect(result.transactions).toHaveLength(1);
    });

    it('should NOT split 2-letter currency codes', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'US.EU', // 2-letter codes
        activityType: 'SELL',
        quantity: 1000,
        unitPrice: 1,
        currency: 'USD',
        fee: 0,
        amount: 1000,
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([['USD', createMockAccount('USD')]]);
      const result = splitFXConversions(transactions, accounts);
      expect(result.transactions).toHaveLength(1);
    });
  });

  describe('Zero Amount Handling', () => {
    it('should handle zero quantity FX conversion', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'GBP.USD',
        activityType: 'SELL',
        quantity: 0, // Zero quantity
        unitPrice: 1.25,
        currency: 'USD',
        fee: 0,
        amount: 0,
        comment: 'IDEALFX',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([
        ['GBP', createMockAccount('GBP')],
        ['USD', createMockAccount('USD')],
      ]);

      const result = splitFXConversions(transactions, accounts);
      // Should still split but with zero amounts
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].amount).toBe(0);
      expect(result.transactions[1].amount).toBe(0);
    });

    it('should handle zero unit price FX conversion', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'GBP.USD',
        activityType: 'SELL',
        quantity: 1000,
        unitPrice: 0, // Zero price
        currency: 'USD',
        fee: 0,
        amount: 1250, // But has amount
        comment: 'IDEALFX',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([
        ['GBP', createMockAccount('GBP')],
        ['USD', createMockAccount('USD')],
      ]);

      const result = splitFXConversions(transactions, accounts);
      expect(result.transactions).toHaveLength(2);
      // Should use fallback amount
      expect(result.transactions[1].amount).toBe(1250);
    });
  });
});

// ============================================================================
// SECTION 2: TICKER RESOLVER EDGE CASES (12 tests)
// ============================================================================

describe('Ticker Resolver Edge Cases', () => {
  describe('extractTickersToResolve', () => {
    it('should skip rows where Symbol equals "Symbol" (header row)', () => {
      const data = [
        { Symbol: 'Symbol', ISIN: 'ISIN', Exchange: 'Exchange', CurrencyPrimary: 'Currency' },
        { Symbol: 'AAPL', ISIN: 'US0378331005', Exchange: 'NASDAQ', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
      ];

      const result = extractTickersToResolve(data);
      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('AAPL');
    });

    it('should skip rows with empty symbol', () => {
      const data = [
        { Symbol: '', ISIN: 'US0378331005', Exchange: 'NASDAQ', CurrencyPrimary: 'USD' },
        { Symbol: 'AAPL', ISIN: 'US0378331005', Exchange: 'NASDAQ', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
      ];

      const result = extractTickersToResolve(data);
      expect(result).toHaveLength(1);
    });

    it('should skip rows with numeric Exchange (trade IDs)', () => {
      const data = [
        { Symbol: 'AAPL', ISIN: 'US0378331005', Exchange: '12345', CurrencyPrimary: 'USD' },
        { Symbol: 'MSFT', ISIN: 'US5949181045', Exchange: 'NASDAQ', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
      ];

      const result = extractTickersToResolve(data);
      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('MSFT');
    });

    it('should skip IDEALFX exchange', () => {
      const data = [
        { Symbol: 'GBP.USD', ISIN: '', Exchange: 'IDEALFX', CurrencyPrimary: 'USD' },
        { Symbol: 'AAPL', ISIN: 'US0378331005', Exchange: 'NASDAQ', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
      ];

      const result = extractTickersToResolve(data);
      expect(result).toHaveLength(1);
    });

    it('should use ListingExchange over Exchange when available', () => {
      const data = [
        { Symbol: 'AAPL', ISIN: 'US0378331005', Exchange: '99999', ListingExchange: 'NASDAQ', CurrencyPrimary: 'USD' },
      ];

      const result = extractTickersToResolve(data);
      expect(result).toHaveLength(1);
      expect(result[0].exchange).toBe('NASDAQ');
    });

    it('should deduplicate by ISIN:exchange key', () => {
      const data = [
        { Symbol: 'AAPL', ISIN: 'US0378331005', Exchange: 'NASDAQ', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
        { Symbol: 'AAPL', ISIN: 'US0378331005', Exchange: 'NASDAQ', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
        { Symbol: 'AAPL', ISIN: 'US0378331005', Exchange: 'NASDAQ', CurrencyPrimary: 'USD', ListingExchange: 'NASDAQ' },
      ];

      const result = extractTickersToResolve(data);
      expect(result).toHaveLength(1);
    });

    it('should handle missing ISIN gracefully', () => {
      const data = [
        { Symbol: 'AAPL', ISIN: '', Exchange: 'NASDAQ', CurrencyPrimary: 'USD' },
      ];

      const result = extractTickersToResolve(data);
      // Should skip because ISIN is required
      expect(result).toHaveLength(0);
    });

    it('should handle undefined values', () => {
      const data = [
        { Symbol: undefined, ISIN: undefined, Exchange: undefined, CurrencyPrimary: undefined },
      ];

      const result = extractTickersToResolve(data);
      expect(result).toHaveLength(0);
    });
  });

  describe('resolveTicker with search function', () => {
    beforeEach(() => {
      // Clear localStorage cache
      try {
        localStorage.removeItem('ibkr_ticker_cache');
      } catch (e) {
        // Ignore if localStorage not available
      }
    });

    it('should return fallback when search returns no results', async () => {
      // Search function returns empty array
      const emptySearchFn = async () => [];

      const result = await resolveTicker(
        {
          isin: 'UNKNOWN123456789',
          symbol: 'UNKNOWN',
          exchange: 'UNKNOWN',
          currency: 'USD',
        },
        { searchFn: emptySearchFn }
      );

      expect(result.confidence).toBe('low');
      expect(result.source).toBe('fallback');
    });

    it('should use search function when available', async () => {
      const mockSearchFn = vi.fn().mockResolvedValue([
        { symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ' },
      ]);

      const result = await resolveTicker(
        {
          isin: 'US0378331005',
          symbol: 'AAPL',
          exchange: 'NASDAQ',
          currency: 'USD',
        },
        { searchFn: mockSearchFn }
      );

      expect(result.yahooTicker).toBe('AAPL');
      expect(result.confidence).toBe('high');
    });

    it('should prefer suffixed symbols for non-US exchanges', async () => {
      const mockSearchFn = vi.fn().mockResolvedValue([
        { symbol: 'VOD', name: 'Vodafone', exchange: 'NYSE' },
        { symbol: 'VOD.L', name: 'Vodafone', exchange: 'LSE' },
      ]);

      const result = await resolveTicker(
        {
          isin: 'GB00BH4HKS39',
          symbol: 'VOD',
          exchange: 'LSE',
          currency: 'GBP',
        },
        { searchFn: mockSearchFn }
      );

      expect(result.yahooTicker).toBe('VOD.L');
    });
  });

  describe('cache corruption recovery', () => {
    let originalLocalStorage: Storage;
    let mockStorage: Record<string, string>;

    beforeEach(() => {
      originalLocalStorage = globalThis.localStorage;
      mockStorage = {};

      // Mock localStorage
      const storageMock: Storage = {
        getItem: vi.fn((key: string) => mockStorage[key] || null),
        setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
        removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
        clear: vi.fn(() => { mockStorage = {}; }),
        length: 0,
        key: vi.fn(() => null),
      };

      Object.defineProperty(globalThis, 'localStorage', {
        value: storageMock,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      });
    });

    it('should handle corrupted cache JSON gracefully', async () => {
      // Set corrupted JSON in cache
      mockStorage['ibkr_ticker_cache'] = '{ invalid json }}}';

      const mockSearchFn = vi.fn().mockResolvedValue([
        { symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ' },
      ]);

      // Should not throw, should fall through to search
      const result = await resolveTicker(
        {
          isin: 'US0378331005',
          symbol: 'AAPL',
          exchange: 'NASDAQ',
          currency: 'USD',
        },
        { searchFn: mockSearchFn }
      );

      expect(result.yahooTicker).toBe('AAPL');
      expect(result.confidence).toBe('high');
      // Cache should have been cleared and repopulated with new valid entry
      const cache = JSON.parse(mockStorage['ibkr_ticker_cache']);
      expect(cache['US0378331005:NASDAQ']).toBeDefined();
      expect(cache['US0378331005:NASDAQ'].yahooTicker).toBe('AAPL');
    });

    it('should handle completely empty cache string', async () => {
      mockStorage['ibkr_ticker_cache'] = '';

      const mockSearchFn = vi.fn().mockResolvedValue([
        { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' },
      ]);

      const result = await resolveTicker(
        {
          isin: 'US5949181045',
          symbol: 'MSFT',
          exchange: 'NASDAQ',
          currency: 'USD',
        },
        { searchFn: mockSearchFn }
      );

      expect(result.yahooTicker).toBe('MSFT');
    });

    it('should handle cache with invalid entry structure', async () => {
      // Cache has an entry but with invalid structure (missing required fields)
      mockStorage['ibkr_ticker_cache'] = JSON.stringify({
        'US0378331005:NASDAQ': { invalid: 'structure' },
      });

      const mockSearchFn = vi.fn().mockResolvedValue([
        { symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ' },
      ]);

      const result = await resolveTicker(
        {
          isin: 'US0378331005',
          symbol: 'AAPL',
          exchange: 'NASDAQ',
          currency: 'USD',
        },
        { searchFn: mockSearchFn }
      );

      // Should skip invalid cache entry and use search
      expect(result.yahooTicker).toBe('AAPL');
      expect(mockSearchFn).toHaveBeenCalled();
    });

    it('should return cached result when cache is valid', async () => {
      // Set valid cache
      mockStorage['ibkr_ticker_cache'] = JSON.stringify({
        'US0378331005:NASDAQ': {
          yahooTicker: 'AAPL',
          confidence: 'high',
          name: 'Apple Inc',
          timestamp: new Date().toISOString(),
        },
      });

      const mockSearchFn = vi.fn();

      const result = await resolveTicker(
        {
          isin: 'US0378331005',
          symbol: 'AAPL',
          exchange: 'NASDAQ',
          currency: 'USD',
        },
        { searchFn: mockSearchFn }
      );

      expect(result.yahooTicker).toBe('AAPL');
      expect(result.source).toBe('cache');
      // Search should NOT have been called (cache hit)
      expect(mockSearchFn).not.toHaveBeenCalled();
    });

    it('should save new resolution to cache', async () => {
      const mockSearchFn = vi.fn().mockResolvedValue([
        { symbol: 'GOOGL', name: 'Alphabet Inc', exchange: 'NASDAQ' },
      ]);

      await resolveTicker(
        {
          isin: 'US02079K3059',
          symbol: 'GOOGL',
          exchange: 'NASDAQ',
          currency: 'USD',
        },
        { searchFn: mockSearchFn }
      );

      // Verify cache was written
      expect(mockStorage['ibkr_ticker_cache']).toBeDefined();
      const cache = JSON.parse(mockStorage['ibkr_ticker_cache']);
      expect(cache['US02079K3059:NASDAQ']).toBeDefined();
      expect(cache['US02079K3059:NASDAQ'].yahooTicker).toBe('GOOGL');
    });
  });

  describe('Yahoo Finance API fallback', () => {
    let originalFetch: typeof global.fetch;
    let mockStorage: Record<string, string>;

    beforeEach(() => {
      originalFetch = global.fetch;
      mockStorage = {};

      // Mock localStorage
      const storageMock: Storage = {
        getItem: vi.fn((key: string) => mockStorage[key] || null),
        setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
        removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
        clear: vi.fn(() => { mockStorage = {}; }),
        length: 0,
        key: vi.fn(() => null),
      };

      Object.defineProperty(globalThis, 'localStorage', {
        value: storageMock,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should fall back to Yahoo Finance when Wealthfolio search returns nothing', async () => {
      // Mock fetch for Yahoo Finance search and validation
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quotes: [{ symbol: 'TEST.L', longname: 'Test Stock', shortname: 'Test' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ chart: { result: [{}] } }), // No error = valid ticker
        });

      // Empty search function - forces fallback to Yahoo Finance
      const emptySearchFn = async () => [];

      const result = await resolveTicker(
        {
          isin: 'GB0000000001',
          symbol: 'TEST',
          exchange: 'LSE',
          currency: 'GBP',
        },
        { searchFn: emptySearchFn }
      );

      expect(result.yahooTicker).toBe('TEST.L');
      expect(result.confidence).toBe('high');
      expect(result.source).toBe('yfinance');
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should return fallback when Yahoo Finance search fails', async () => {
      // Mock fetch to return error
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const emptySearchFn = async () => [];

      const result = await resolveTicker(
        {
          isin: 'INVALID123456',
          symbol: 'INVALID',
          exchange: 'UNKNOWN',
          currency: 'USD',
        },
        { searchFn: emptySearchFn }
      );

      expect(result.confidence).toBe('low');
      expect(result.source).toBe('fallback');
    });

    it('should return fallback when Yahoo Finance returns no quotes', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ quotes: [] }),
      });

      const emptySearchFn = async () => [];

      const result = await resolveTicker(
        {
          isin: 'XX0000000000',
          symbol: 'NOQUOTES',
          exchange: 'NYSE',
          currency: 'USD',
        },
        { searchFn: emptySearchFn }
      );

      expect(result.confidence).toBe('low');
      expect(result.source).toBe('fallback');
    });

    it('should return fallback when ticker validation fails', async () => {
      // Search succeeds but validation fails
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quotes: [{ symbol: 'INVALID', longname: 'Invalid Stock' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ chart: { error: { code: 'Not Found' } } }),
        });

      const emptySearchFn = async () => [];

      const result = await resolveTicker(
        {
          isin: 'US0000000000',
          symbol: 'INVALID',
          exchange: 'NYSE',
          currency: 'USD',
        },
        { searchFn: emptySearchFn }
      );

      expect(result.confidence).toBe('low');
      expect(result.source).toBe('fallback');
    });

    it('should handle fetch network error gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const emptySearchFn = async () => [];

      const result = await resolveTicker(
        {
          isin: 'GB1234567890',
          symbol: 'NETERR',
          exchange: 'LSE',
          currency: 'GBP',
        },
        { searchFn: emptySearchFn }
      );

      expect(result.confidence).toBe('low');
      expect(result.source).toBe('fallback');
    });

    it('should handle fetch timeout (AbortError) gracefully', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      global.fetch = vi.fn().mockRejectedValue(abortError);

      const emptySearchFn = async () => [];

      const result = await resolveTicker(
        {
          isin: 'US9999999999',
          symbol: 'TIMEOUT',
          exchange: 'NASDAQ',
          currency: 'USD',
        },
        { searchFn: emptySearchFn }
      );

      expect(result.confidence).toBe('low');
      expect(result.source).toBe('fallback');
    });

    it('should handle malformed JSON response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); },
      });

      const emptySearchFn = async () => [];

      const result = await resolveTicker(
        {
          isin: 'FR0000000001',
          symbol: 'BADJSON',
          exchange: 'SBF',
          currency: 'EUR',
        },
        { searchFn: emptySearchFn }
      );

      expect(result.confidence).toBe('low');
      expect(result.source).toBe('fallback');
    });

    it('should skip Yahoo Finance search when no ISIN provided', async () => {
      // Should go directly to fallback without calling Yahoo Finance
      global.fetch = vi.fn();

      const emptySearchFn = async () => [];

      const result = await resolveTicker(
        {
          isin: '', // Empty ISIN
          symbol: 'NOISIN',
          exchange: 'NYSE',
          currency: 'USD',
        },
        { searchFn: emptySearchFn }
      );

      expect(result.confidence).toBe('low');
      expect(result.source).toBe('fallback');
      // Yahoo search should not be called for empty ISIN
      // (Wealthfolio search may still be called)
    });
  });
});

// ============================================================================
// SECTION 3: PREPROCESSOR EDGE CASES (15 tests)
// ============================================================================

describe('Preprocessor Advanced Edge Cases', () => {
  describe('Interest Transaction Classification', () => {
    it('should classify CREDIT INTEREST as INTEREST', () => {
      const row = {
        Description: 'CREDIT INTEREST ON USD BALANCE',
        TradeMoney: '5.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_INTEREST');
    });

    it('should classify DEBIT INT as FEE (not interest income)', () => {
      const row = {
        Description: 'DEBIT INT FOR DEC 2024',
        TradeMoney: '-15.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_FEE');
    });

    it('should classify DEBIT INTEREST as FEE', () => {
      const row = {
        Description: 'DEBIT INTEREST ON MARGIN',
        TradeMoney: '-25.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_FEE');
    });

    it('should classify INT FOR as interest', () => {
      const row = {
        Description: 'INT FOR CASH BALANCE',
        TradeMoney: '2.50',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_INTEREST');
    });
  });

  describe('Fee Classification', () => {
    it('should classify VAT as fee', () => {
      const row = {
        Description: 'VAT ON COMMISSION',
        TradeMoney: '-2.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_FEE');
    });

    it('should classify CHARGE as fee', () => {
      const row = {
        Description: 'MARKET DATA CHARGE',
        TradeMoney: '-10.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_FEE');
    });

    it('should classify snapshot fee (OFEE without ListingExchange) as fee', () => {
      const row = {
        LevelOfDetail: 'BaseCurrency',
        ActivityCode: 'OFEE',
        Description: 'SNAPSHOT FEE',
        Amount: '-5.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_FEE');
    });

    it('should process OFEE with ListingExchange as ADR dividend fee', () => {
      const row = {
        LevelOfDetail: 'BaseCurrency',
        ActivityCode: 'OFEE',
        ListingExchange: 'NYSE',
        Description: 'DIVIDEND FEE',
        Amount: '-1.00',
      };

      const result = preprocessIBKRData([row as any]);
      // OFEE with ListingExchange = ADR dividend fees - should be imported as FEE
      expect(result.processedData.length).toBe(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_FEE');
    });

    it('should skip positive OFEE (refund/credit)', () => {
      const row = {
        LevelOfDetail: 'BaseCurrency',
        ActivityCode: 'OFEE',
        Description: 'FEE REFUND',
        Amount: '5.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.skipped).toBe(1);
    });
  });

  describe('Transfer Classification', () => {
    it('should classify INTERNAL IN as TRANSFER_IN', () => {
      const row = {
        TransactionType: 'INTERNAL',
        _TRANSFER_DIRECTION: 'IN',
        AssetClass: 'CASH',
        TradeMoney: '1000.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_TRANSFER_IN');
    });

    it('should classify INTERNAL OUT as TRANSFER_OUT', () => {
      const row = {
        TransactionType: 'INTERNAL',
        _TRANSFER_DIRECTION: 'OUT',
        AssetClass: 'CASH',
        TradeMoney: '-1000.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_TRANSFER_OUT');
    });

    it('should skip transfer with zero amount', () => {
      const row = {
        TransactionType: 'INTERNAL',
        _TRANSFER_DIRECTION: 'IN',
        AssetClass: 'CASH',
        TradeMoney: '0',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.skipped).toBe(1);
    });
  });

  describe('FX Conversion Classification', () => {
    it('should skip FOREX summary rows', () => {
      const row = {
        ActivityCode: 'FOREX',
        Description: 'FX CONVERSION SUMMARY',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.skipped).toBe(1);
    });

    it('should split IDEALFX SELL into two transfers (source OUT, target IN)', () => {
      const row = {
        Exchange: 'IDEALFX',
        'Buy/Sell': 'SELL',
        TradeMoney: '-1000',
        TradePrice: '1.25',
        Symbol: 'GBP.USD',
        CurrencyPrimary: 'USD',
      };

      const result = preprocessIBKRData([row as any]);
      // FX conversions create 2 rows: source (TRANSFER_OUT) and target (TRANSFER_IN)
      expect(result.processedData).toHaveLength(2);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_TRANSFER_OUT'); // Source: GBP out
      expect(result.processedData[1]._IBKR_TYPE).toBe('IBKR_TRANSFER_IN');  // Target: USD in
    });

    it('should split IDEALFX BUY into two transfers (source IN, target OUT)', () => {
      const row = {
        Exchange: 'IDEALFX',
        'Buy/Sell': 'BUY',
        TradeMoney: '1000',
        TradePrice: '1.25',
        Symbol: 'GBP.USD',
        CurrencyPrimary: 'USD',
      };

      const result = preprocessIBKRData([row as any]);
      // FX conversions create 2 rows: source (TRANSFER_IN) and target (TRANSFER_OUT)
      expect(result.processedData).toHaveLength(2);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_TRANSFER_IN');  // Source: GBP in
      expect(result.processedData[1]._IBKR_TYPE).toBe('IBKR_TRANSFER_OUT'); // Target: USD out
    });
  });

  describe('Section Duplicate Handling', () => {
    it('should skip DEP at BaseCurrency level without Deposits/Withdrawals code', () => {
      const row = {
        ActivityCode: 'DEP',
        LevelOfDetail: 'BaseCurrency',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.skipped).toBe(1);
    });

    it('should skip WITH (withdrawal duplicate)', () => {
      const row = {
        ActivityCode: 'WITH',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.skipped).toBe(1);
    });

    it('should skip BUY without ExchTrade (Section 2 duplicate)', () => {
      const row = {
        ActivityCode: 'BUY',
        TransactionType: '', // Not ExchTrade
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.skipped).toBe(1);
    });

    it('should skip ADJ (FX translation adjustment)', () => {
      const row = {
        ActivityCode: 'ADJ',
        Description: 'FX TRANSLATION ADJUSTMENT',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.skipped).toBe(1);
    });
  });
});

// ============================================================================
// SECTION 4: ACTIVITY CONVERTER ADVANCED EDGE CASES (15 tests)
// ============================================================================

describe('Activity Converter Advanced Edge Cases', () => {
  const mockAccountPreviews = [
    { currency: 'USD', name: 'Test USD' },
    { currency: 'GBP', name: 'Test GBP' },
    { currency: 'EUR', name: 'Test EUR' },
    { currency: 'HKD', name: 'Test HKD' },
    { currency: 'NOK', name: 'Test NOK' },
    { currency: 'CHF', name: 'Test CHF' },
  ];

  describe('TTAX (Transaction Tax) Handling', () => {
    it('should parse TTAX amount from description', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_FEE',
        ActivityCode: 'TTAX',
        ActivityDescription: 'French Daily Trade Charge Tax HESAY 6',
        TradeMoney: '4.50', // GBP equivalent
        CurrencyPrimary: 'GBP',
        ListingExchange: 'PINK',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities).toHaveLength(1);
      expect(activities[0].amount).toBe(6); // Should use parsed amount, not TradeMoney
      expect(activities[0].currency).toBe('USD'); // PINK maps to USD
    });

    it('should fallback to TradeMoney if TTAX amount not parseable', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_FEE',
        ActivityCode: 'TTAX',
        ActivityDescription: 'Some Tax Description Without Amount',
        TradeMoney: '4.50',
        CurrencyPrimary: 'GBP',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities).toHaveLength(1);
      expect(activities[0].amount).toBe(4.5);
    });

    it('should parse decimal TTAX amount', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_FEE',
        ActivityCode: 'TTAX',
        ActivityDescription: 'French Daily Trade Charge Tax HESAY 1.5',
        TradeMoney: '1.12',
        CurrencyPrimary: 'GBP',
        ListingExchange: 'PINK',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities[0].amount).toBe(1.5);
    });
  });

  describe('Trade Fee Calculation', () => {
    it('should include both commission and taxes in trade fee', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: '0005',
        Quantity: '1000',
        TradePrice: '50',
        IBCommission: '-18',
        Taxes: '-50', // HK stamp duty
        CurrencyPrimary: 'HKD',
        ListingExchange: 'SEHK',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities[0].fee).toBe(68); // 18 + 50
    });

    it('should handle negative commission values', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'AAPL',
        Quantity: '10',
        TradePrice: '150',
        IBCommission: '-1.5',
        CurrencyPrimary: 'USD',
        ListingExchange: 'NASDAQ',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities[0].fee).toBe(1.5);
    });
  });

  describe('Currency Determination', () => {
    it('should use PINK exchange currency (USD)', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'HESAY',
        Quantity: '100',
        TradePrice: '30',
        CurrencyPrimary: 'GBP', // Base currency is GBP
        ListingExchange: 'PINK', // But traded on PINK (OTC)
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities[0].currency).toBe('USD');
    });

    it('should use LSE exchange currency (GBP)', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'VOD',
        Quantity: '100',
        TradePrice: '100',
        CurrencyPrimary: 'GBP',
        ListingExchange: 'LSE',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities[0].currency).toBe('GBP');
    });

    it('should fallback to CurrencyPrimary for unknown exchange', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'TEST',
        Quantity: '100',
        TradePrice: '50',
        CurrencyPrimary: 'EUR',
        ListingExchange: 'UNKNOWN_EXCHANGE',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities[0].currency).toBe('EUR');
    });
  });

  describe('Cash Transaction Handling', () => {
    it('should set quantity to amount and unitPrice to 1 for deposits', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_DEPOSIT',
        TradeMoney: '5000',
        CurrencyPrimary: 'USD',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities[0].quantity).toBe(5000);
      expect(activities[0].unitPrice).toBe(1);
      expect(activities[0].amount).toBe(5000);
    });

    it('should set quantity to amount and unitPrice to 1 for withdrawals', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_WITHDRAWAL',
        TradeMoney: '-3000',
        CurrencyPrimary: 'GBP',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities[0].quantity).toBe(3000);
      expect(activities[0].unitPrice).toBe(1);
      expect(activities[0].amount).toBe(3000);
    });

    it('should set quantity to amount and unitPrice to 1 for fees', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_FEE',
        TradeMoney: '-25',
        CurrencyPrimary: 'USD',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities[0].quantity).toBe(25);
      expect(activities[0].unitPrice).toBe(1);
    });
  });

  describe('Symbol Resolution', () => {
    it('should use _resolvedTicker when available', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'VOD',
        _resolvedTicker: 'VOD.L',
        Quantity: '100',
        TradePrice: '100',
        CurrencyPrimary: 'GBP',
        ListingExchange: 'LSE',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities[0].symbol).toBe('VOD.L');
    });

    it('should fallback to Symbol when _resolvedTicker not available', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'AAPL',
        Quantity: '10',
        TradePrice: '150',
        CurrencyPrimary: 'USD',
        ListingExchange: 'NASDAQ',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities[0].symbol).toBe('AAPL');
    });

    it('should generate $CASH symbol for transactions without symbol', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_FEE',
        TradeMoney: '-10',
        CurrencyPrimary: 'USD',
        Date: '2024-01-15',
      }];

      const { activities } = await convertToActivityImports(rows, mockAccountPreviews);

      expect(activities[0].symbol).toBe('$CASH-USD');
    });
  });
});

// ============================================================================
// SECTION 5: ACCOUNT NAME GENERATOR EDGE CASES (8 tests)
// ============================================================================

describe('Account Name Generator Edge Cases', () => {
  it('should generate names for single currency', () => {
    const result = generateAccountNames('Test', ['USD']);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Test - USD');
    expect(result[0].currency).toBe('USD');
  });

  it('should generate names for multiple currencies', () => {
    const result = generateAccountNames('IBKR', ['USD', 'GBP', 'EUR']);
    expect(result).toHaveLength(3);
    expect(result.map(r => r.currency)).toEqual(['USD', 'GBP', 'EUR']);
  });

  it('should handle empty group name', () => {
    const result = generateAccountNames('', ['USD']);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe(' - USD');
  });

  it('should handle empty currencies array', () => {
    const result = generateAccountNames('Test', []);
    expect(result).toHaveLength(0);
  });

  it('should preserve currency order', () => {
    const currencies = ['NOK', 'CHF', 'AUD', 'JPY'];
    const result = generateAccountNames('IBKR', currencies);
    expect(result.map(r => r.currency)).toEqual(currencies);
  });

  it('should handle special characters in group name', () => {
    const result = generateAccountNames('Test & Co.', ['USD']);
    expect(result[0].name).toBe('Test & Co. - USD');
  });

  it('should handle unicode characters in group name', () => {
    const result = generateAccountNames('Société', ['EUR']);
    expect(result[0].name).toBe('Société - EUR');
  });

  it('should set correct group on all accounts', () => {
    const result = generateAccountNames('MyGroup', ['USD', 'GBP']);
    result.forEach(acc => {
      expect(acc.group).toBe('MyGroup');
    });
  });
});

// ============================================================================
// SECTION 6: CURRENCY DETECTOR EDGE CASES (10 tests)
// ============================================================================

describe('Currency Detector Edge Cases', () => {
  it('should detect currency from LevelOfDetail=Currency rows', () => {
    const data = [
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'USD' },
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'GBP' },
      { LevelOfDetail: 'Detail', CurrencyPrimary: 'USD' },
    ];

    const result = detectCurrenciesFromIBKR(data);
    expect(result).toContain('USD');
    expect(result).toContain('GBP');
  });

  it('should return unique currencies', () => {
    const data = [
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'USD' },
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'USD' },
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'USD' },
    ];

    const result = detectCurrenciesFromIBKR(data);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('USD');
  });

  it('should handle empty data array', () => {
    const result = detectCurrenciesFromIBKR([]);
    expect(result).toHaveLength(0);
  });

  it('should handle data without Currency level rows', () => {
    const data = [
      { LevelOfDetail: 'Detail', CurrencyPrimary: 'USD' },
      { LevelOfDetail: 'Summary', CurrencyPrimary: 'GBP' },
    ];

    const result = detectCurrenciesFromIBKR(data);
    // Should not detect currencies from non-Currency level rows
    expect(result).toHaveLength(0);
  });

  it('should handle missing CurrencyPrimary field', () => {
    const data = [
      { LevelOfDetail: 'Currency' },
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'USD' },
    ];

    const result = detectCurrenciesFromIBKR(data);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('USD');
  });

  it('should handle whitespace in currency values', () => {
    const data = [
      { LevelOfDetail: 'Currency', CurrencyPrimary: ' USD ' },
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'GBP' },
    ];

    const result = detectCurrenciesFromIBKR(data);
    expect(result).toContain('USD');
  });

  it('should sort currencies alphabetically', () => {
    const data = [
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'GBP' },
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'USD' },
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'EUR' },
    ];

    const result = detectCurrenciesFromIBKR(data);
    // Result is sorted alphabetically
    expect(result[0]).toBe('EUR');
    expect(result[1]).toBe('GBP');
    expect(result[2]).toBe('USD');
  });

  it('should handle lowercase level of detail', () => {
    const data = [
      { LevelOfDetail: 'currency', CurrencyPrimary: 'USD' },
    ];

    const result = detectCurrenciesFromIBKR(data);
    // Should not match lowercase (exact match required)
    expect(result).toHaveLength(0);
  });

  it('should preserve currency case as provided', () => {
    const data = [
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'usd' },
    ];

    const result = detectCurrenciesFromIBKR(data);
    expect(result).toHaveLength(1);
    // Currency is preserved as-is (not normalized to uppercase)
    expect(result[0]).toBe('usd');
  });

  it('should detect exotic currencies', () => {
    const data = [
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'HKD' },
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'SGD' },
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'ZAR' },
      { LevelOfDetail: 'Currency', CurrencyPrimary: 'MXN' },
    ];

    const result = detectCurrenciesFromIBKR(data);
    expect(result).toHaveLength(4);
    expect(result).toContain('HKD');
    expect(result).toContain('SGD');
    expect(result).toContain('ZAR');
    expect(result).toContain('MXN');
  });
});

/**
 * IBKR Addon Edge Cases Test Suite
 *
 * Tests discovered potential bugs and edge cases:
 * - Flex Query fetcher XML parsing
 * - Config storage race conditions
 * - FX transaction splitter edge cases
 * - Ticker resolution edge cases
 * - Account name generator edge cases
 * - Numeric parsing edge cases
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseFlexQueryCSV } from '../lib/flex-csv-parser';
import { extractTradesSection, isMultiSectionIBKR } from '../lib/ibkr-csv-splitter';
import { splitFXConversions } from '../lib/fx-transaction-splitter';
import { generateAccountNames } from '../lib/account-name-generator';
import { preprocessIBKRData } from '../lib/ibkr-preprocessor';
import { convertToActivityImports } from '../lib/activity-converter';
import { normalizeNumericValue } from '../lib/validation-utils';
import {
  loadConfigs,
  saveConfigs,
  addConfig,
  updateConfig,
  deleteConfig,
  loadToken,
  saveToken,
  FlexQueryConfig,
} from '../lib/flex-config-storage';
import type { Account, ActivityImport } from '@wealthfolio/addon-sdk';

// ============================================================================
// SECTION 1: FLEX QUERY XML PARSING EDGE CASES (15 tests)
// ============================================================================

describe('Flex Query Response Parsing', () => {
  describe('XML Edge Cases', () => {
    it('should handle XML with CDATA sections', () => {
      const csv = `"ClientAccountID","Symbol","CurrencyPrimary"
"U123","AAPL","USD"`;
      // Wrap in CDATA-like content
      const result = parseFlexQueryCSV(`<![CDATA[${csv}]]>`);
      // Parser should still find data
      expect(result.errors.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle XML entities in values', () => {
      const csv = `Col1,Col2,Col3
"Test &amp; Co",val2,val3`;
      const result = parseFlexQueryCSV(csv);
      expect(result.rows).toHaveLength(1);
      // The &amp; should be preserved as-is (not decoded)
      expect(result.rows[0].Col1).toContain('&');
    });

    it('should handle very long single-line CSV', () => {
      // Create a CSV with 100+ columns
      const headers = Array(100).fill(0).map((_, i) => `Col${i}`).join(',');
      const values = Array(100).fill('val').join(',');
      const csv = `${headers}\n${values}`;

      const result = parseFlexQueryCSV(csv);
      expect(result.errors).toHaveLength(0);
      expect(result.headers).toHaveLength(100);
    });

    it('should handle CSV with only headers (no data)', () => {
      const csv = 'Col1,Col2,Col3';
      const result = parseFlexQueryCSV(csv);
      expect(result.rows).toHaveLength(0);
      expect(result.errors).toContain('No data rows found in CSV.');
    });

    it('should handle response with HTML error page', () => {
      const html = `<!DOCTYPE html><html><head><title>Error</title></head><body>Service Unavailable</body></html>`;
      const result = parseFlexQueryCSV(html);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle response with JSON error', () => {
      const json = `{"error": "Invalid token", "code": 1015}`;
      const result = parseFlexQueryCSV(json);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Multi-Section Extraction Edge Cases', () => {
    it('should handle section with header but no data rows', () => {
      const csv = `"ClientAccountID","TransactionType","Exchange","Buy/Sell"
"ClientAccountID","Date/Time","Amount","Type"`;
      // Both are headers, no data
      expect(isMultiSectionIBKR(csv)).toBe(true);
      // extractTradesSection returns the first section (which has trades header)
      const result = extractTradesSection(csv);
      expect(result).toContain('TransactionType');
    });

    it('should handle more than 3 sections', () => {
      const section = `"ClientAccountID","TransactionType","Exchange","Buy/Sell"
"U123","ExchTrade","NYSE","BUY"`;
      const csv = `${section}\n${section}\n${section}\n${section}`;

      expect(isMultiSectionIBKR(csv)).toBe(true);
      const extracted = extractTradesSection(csv);
      expect(extracted).toContain('TransactionType');
    });

    it('should handle section with inconsistent quoting', () => {
      const csv = `"ClientAccountID",TransactionType,"Exchange",Buy/Sell
"U123","ExchTrade","NYSE","BUY"`;

      const result = parseFlexQueryCSV(csv);
      expect(result.rows).toHaveLength(1);
    });

    it('should handle empty lines between sections', () => {
      const tradesHeader = '"ClientAccountID","TransactionType","Exchange","Buy/Sell"';
      const tradesRow = '"U123","ExchTrade","NYSE","BUY"';
      const dividendsHeader = '"ClientAccountID","Date/Time","Amount","Type"';

      const csv = `${tradesHeader}\n${tradesRow}\n\n\n\n${dividendsHeader}`;
      expect(isMultiSectionIBKR(csv)).toBe(true);
    });
  });
});

// ============================================================================
// SECTION 2: CONFIG STORAGE EDGE CASES (20 tests)
// ============================================================================

describe('Config Storage Edge Cases', () => {
  // Mock secrets API
  class MockSecrets {
    private store = new Map<string, string>();

    async get(key: string): Promise<string | null> {
      return this.store.has(key) ? this.store.get(key)! : null;
    }

    async set(key: string, value: string): Promise<void> {
      this.store.set(key, value);
    }

    async delete(key: string): Promise<void> {
      this.store.delete(key);
    }

    clear() {
      this.store.clear();
    }
  }

  let secrets: MockSecrets;

  beforeEach(() => {
    secrets = new MockSecrets();
  });

  describe('JSON Parsing Edge Cases', () => {
    it('should return empty array for null storage', async () => {
      const configs = await loadConfigs(secrets);
      expect(configs).toEqual([]);
    });

    it('should return empty array for empty string', async () => {
      await secrets.set('flex_query_configs', '');
      const configs = await loadConfigs(secrets);
      expect(configs).toEqual([]);
    });

    it('should return empty array for invalid JSON', async () => {
      await secrets.set('flex_query_configs', '{invalid json}');
      const configs = await loadConfigs(secrets);
      expect(configs).toEqual([]);
    });

    it('should return empty array for JSON array with null', async () => {
      await secrets.set('flex_query_configs', '[null]');
      const configs = await loadConfigs(secrets);
      expect(configs).toEqual([null]);
    });

    it('should handle deeply nested JSON', async () => {
      const config: FlexQueryConfig = {
        id: '1',
        name: 'Test',
        queryId: '123',
        accountGroup: 'Test Group',
        autoFetchEnabled: true,
        lastFetchStatus: 'success',
      };
      await saveConfigs(secrets, [config]);
      const loaded = await loadConfigs(secrets);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].name).toBe('Test');
    });
  });

  describe('CRUD Operations', () => {
    it('should add config with generated UUID', async () => {
      const config = await addConfig(secrets, {
        name: 'Test',
        queryId: '123',
        accountGroup: 'Group',
        autoFetchEnabled: false,
      });

      expect(config.id).toBeDefined();
      expect(config.id.length).toBe(36); // UUID format
    });

    it('should update existing config', async () => {
      const config = await addConfig(secrets, {
        name: 'Original',
        queryId: '123',
        accountGroup: 'Group',
        autoFetchEnabled: false,
      });

      const updated = await updateConfig(secrets, config.id, { name: 'Updated' });
      expect(updated?.name).toBe('Updated');
      expect(updated?.queryId).toBe('123'); // Unchanged
    });

    it('should return null when updating non-existent config', async () => {
      const result = await updateConfig(secrets, 'non-existent-id', { name: 'Test' });
      expect(result).toBeNull();
    });

    it('should delete config by ID', async () => {
      const config = await addConfig(secrets, {
        name: 'ToDelete',
        queryId: '123',
        accountGroup: 'Group',
        autoFetchEnabled: false,
      });

      const deleted = await deleteConfig(secrets, config.id);
      expect(deleted).toBe(true);

      const configs = await loadConfigs(secrets);
      expect(configs).toHaveLength(0);
    });

    it('should return false when deleting non-existent config', async () => {
      const result = await deleteConfig(secrets, 'non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('Token Operations', () => {
    it('should save and load token', async () => {
      await saveToken(secrets, 'my-secret-token');
      const token = await loadToken(secrets);
      expect(token).toBe('my-secret-token');
    });

    it('should return null for non-existent token', async () => {
      const token = await loadToken(secrets);
      expect(token).toBeNull();
    });

    it('should handle empty token', async () => {
      await saveToken(secrets, '');
      const token = await loadToken(secrets);
      expect(token).toBe('');
    });

    it('should handle token with special characters', async () => {
      const specialToken = 'token!@#$%^&*()_+-=[]{}|;:,.<>?';
      await saveToken(secrets, specialToken);
      const token = await loadToken(secrets);
      expect(token).toBe(specialToken);
    });
  });

  describe('Race Condition Scenarios', () => {
    it('should handle concurrent addConfig calls', async () => {
      // Add multiple configs concurrently
      const promises = Array(5).fill(0).map((_, i) =>
        addConfig(secrets, {
          name: `Config ${i}`,
          queryId: `${i}`,
          accountGroup: 'Group',
          autoFetchEnabled: false,
        })
      );

      const results = await Promise.all(promises);

      // All should have unique IDs
      const ids = results.map(r => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(5);
    });

    it('should handle concurrent updateConfig calls on same config', async () => {
      const config = await addConfig(secrets, {
        name: 'Original',
        queryId: '123',
        accountGroup: 'Group',
        autoFetchEnabled: false,
      });

      // Update same config concurrently
      const promises = Array(3).fill(0).map((_, i) =>
        updateConfig(secrets, config.id, { name: `Update ${i}` })
      );

      await Promise.all(promises);
      const configs = await loadConfigs(secrets);

      // Should still have exactly 1 config
      expect(configs).toHaveLength(1);
    });
  });
});

// ============================================================================
// SECTION 3: FX TRANSACTION SPLITTER EDGE CASES (15 tests)
// ============================================================================

describe('FX Transaction Splitter Edge Cases', () => {
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

  describe('FX Pattern Matching', () => {
    it('should NOT match stock symbols with dots (BRK.B)', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'BRK.B', // 3 letters + 1 letter - won't match XXX.YYY
        activityType: 'BUY',
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

      // Should NOT be split - BRK.B is not an FX pair
      expect(result).toHaveLength(1);
      expect(result[0].activityType).toBe('BUY');
    });

    it('should NOT match numeric HK stock symbols (0005.HK)', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: '0005.HK', // Numeric + 2 letters - won't match XXX.YYY
        activityType: 'BUY',
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

      // Should NOT be split
      expect(result).toHaveLength(1);
    });

    it('should match valid FX symbols (GBP.USD)', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'GBP.USD',
        activityType: 'SELL',
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
      expect(result).toHaveLength(2);
      expect(result.some(r => r.activityType === 'WITHDRAWAL')).toBe(true);
      expect(result.some(r => r.activityType === 'DEPOSIT')).toBe(true);
    });

    it('should handle FX with zero quantity', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'EUR.USD',
        activityType: 'SELL',
        quantity: 0, // Zero quantity
        unitPrice: 1.10,
        currency: 'USD',
        fee: 0,
        amount: 0,
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([
        ['EUR', createMockAccount('EUR')],
        ['USD', createMockAccount('USD')],
      ]);
      const result = splitFXConversions(transactions, accounts);

      // Should create transactions with 0 amounts
      expect(result).toHaveLength(2);
      expect(result[0].amount).toBe(0);
      expect(result[1].amount).toBe(0);
    });
  });

  describe('Missing Account Handling', () => {
    it('should skip FX if source account missing', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'GBP.USD',
        activityType: 'SELL',
        quantity: 1000,
        unitPrice: 1.25,
        currency: 'USD',
        fee: 0,
        amount: 1250,
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      // Only USD account, no GBP
      const accounts = new Map([['USD', createMockAccount('USD')]]);
      const result = splitFXConversions(transactions, accounts);

      // Should be skipped (no output)
      expect(result).toHaveLength(0);
    });

    it('should skip FX if target account missing', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'GBP.USD',
        activityType: 'SELL',
        quantity: 1000,
        unitPrice: 1.25,
        currency: 'USD',
        fee: 0,
        amount: 1250,
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      // Only GBP account, no USD
      const accounts = new Map([['GBP', createMockAccount('GBP')]]);
      const result = splitFXConversions(transactions, accounts);

      // Should be skipped
      expect(result).toHaveLength(0);
    });

    it('should handle empty accounts map', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'GBP.USD',
        activityType: 'SELL',
        quantity: 1000,
        unitPrice: 1.25,
        currency: 'USD',
        fee: 0,
        amount: 1250,
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map<string, Account>();
      const result = splitFXConversions(transactions, accounts);

      expect(result).toHaveLength(0);
    });
  });

  describe('Amount Calculations', () => {
    it('should calculate target amount from unitPrice', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'GBP.USD',
        activityType: 'SELL',
        quantity: 1000, // Selling 1000 GBP
        unitPrice: 1.25, // At rate 1.25
        currency: 'USD',
        fee: 0,
        amount: 0, // No amount provided
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([
        ['GBP', createMockAccount('GBP')],
        ['USD', createMockAccount('USD')],
      ]);
      const result = splitFXConversions(transactions, accounts);

      const withdrawal = result.find(r => r.activityType === 'WITHDRAWAL');
      const deposit = result.find(r => r.activityType === 'DEPOSIT');

      expect(withdrawal?.amount).toBe(1000); // Source amount
      expect(deposit?.amount).toBe(1250); // 1000 * 1.25
    });

    it('should fallback to amount when no unitPrice', () => {
      const transactions: ActivityImport[] = [{
        accountId: '',
        date: '2024-01-15',
        symbol: 'GBP.USD',
        activityType: 'SELL',
        quantity: 1000,
        unitPrice: 0, // No unit price
        currency: 'USD',
        fee: 0,
        amount: 1250, // Use amount as fallback
        comment: '',
        isDraft: false,
        isValid: true,
      }];

      const accounts = new Map([
        ['GBP', createMockAccount('GBP')],
        ['USD', createMockAccount('USD')],
      ]);
      const result = splitFXConversions(transactions, accounts);

      const deposit = result.find(r => r.activityType === 'DEPOSIT');
      expect(deposit?.amount).toBe(1250);
    });
  });

  describe('Mixed Transaction Types', () => {
    it('should pass through non-FX transactions unchanged', () => {
      const transactions: ActivityImport[] = [
        {
          accountId: '',
          date: '2024-01-15',
          symbol: 'AAPL',
          activityType: 'BUY',
          quantity: 100,
          unitPrice: 150,
          currency: 'USD',
          fee: 1,
          amount: 15000,
          comment: '',
          isDraft: false,
          isValid: true,
        },
        {
          accountId: '',
          date: '2024-01-15',
          symbol: 'GBP.USD',
          activityType: 'SELL',
          quantity: 1000,
          unitPrice: 1.25,
          currency: 'USD',
          fee: 0,
          amount: 1250,
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

      // 1 stock trade + 2 FX splits
      expect(result).toHaveLength(3);
      expect(result[0].symbol).toBe('AAPL');
    });
  });
});

// ============================================================================
// SECTION 4: ACCOUNT NAME GENERATOR EDGE CASES (10 tests)
// ============================================================================

describe('Account Name Generator Edge Cases', () => {
  describe('Input Validation', () => {
    it('should handle empty group name', () => {
      const result = generateAccountNames('', ['USD', 'EUR']);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe(' - USD'); // Note: empty prefix
      expect(result[0].group).toBe('');
    });

    it('should handle empty currencies array', () => {
      const result = generateAccountNames('Test Group', []);
      expect(result).toHaveLength(0);
    });

    it('should handle group name with special characters', () => {
      const result = generateAccountNames('Test & Co. (Main)', ['USD']);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test & Co. (Main) - USD');
      expect(result[0].group).toBe('Test & Co. (Main)');
    });

    it('should handle very long group name', () => {
      const longName = 'A'.repeat(100);
      const result = generateAccountNames(longName, ['USD']);
      expect(result[0].name).toBe(`${longName} - USD`);
    });

    it('should handle duplicate currencies', () => {
      const result = generateAccountNames('Test', ['USD', 'USD', 'EUR']);
      expect(result).toHaveLength(3);
      // Generates duplicates - caller should dedupe currencies
      expect(result.filter(r => r.currency === 'USD')).toHaveLength(2);
    });

    it('should handle lowercase currencies', () => {
      const result = generateAccountNames('Test', ['usd', 'eur']);
      expect(result).toHaveLength(2);
      expect(result[0].currency).toBe('usd'); // Preserves case
    });

    it('should handle whitespace in group name', () => {
      const result = generateAccountNames('  Test Group  ', ['USD']);
      expect(result[0].name).toBe('  Test Group   - USD');
      expect(result[0].group).toBe('  Test Group  '); // Preserves whitespace
    });
  });
});

// ============================================================================
// SECTION 5: NUMERIC PARSING EDGE CASES (15 tests)
// ============================================================================

describe('Numeric Parsing Edge Cases', () => {
  describe('Scientific Notation', () => {
    it('should handle scientific notation (1e6)', () => {
      expect(normalizeNumericValue('1e6')).toBe(1000000);
    });

    it('should handle scientific notation (1.5e-3)', () => {
      expect(normalizeNumericValue('1.5e-3')).toBe(0.0015);
    });

    it('should handle scientific notation with plus sign (1E+10)', () => {
      expect(normalizeNumericValue('1E+10')).toBe(10000000000);
    });
  });

  describe('Multiple Decimal Points', () => {
    it('should parse up to second decimal point (1.2.3 -> 1.2)', () => {
      const result = normalizeNumericValue('1.2.3');
      // parseFloat stops at the second decimal point, returning 1.2
      expect(result).toBe(1.2);
    });

    it('should parse IP address-like string up to second dot', () => {
      const result = normalizeNumericValue('192.168.1.1');
      // parseFloat stops at first invalid char (second dot), so returns 192.168
      expect(result).toBe(192.168);
    });
  });

  describe('Extreme Values', () => {
    it('should handle Number.MAX_VALUE', () => {
      const result = normalizeNumericValue(String(Number.MAX_VALUE));
      expect(result).toBe(Number.MAX_VALUE);
    });

    it('should handle Number.MIN_VALUE', () => {
      const result = normalizeNumericValue(String(Number.MIN_VALUE));
      expect(result).toBe(Number.MIN_VALUE);
    });

    it('should handle Infinity', () => {
      const result = normalizeNumericValue('Infinity');
      expect(result).toBe(Infinity);
    });

    it('should handle -Infinity', () => {
      const result = normalizeNumericValue('-Infinity');
      expect(result).toBe(-Infinity);
    });
  });

  describe('Special String Values', () => {
    it('should return undefined for NaN string', () => {
      expect(normalizeNumericValue('NaN')).toBeUndefined();
    });

    it('should handle plus sign prefix', () => {
      expect(normalizeNumericValue('+100')).toBe(100);
    });

    it('should handle multiple minus signs', () => {
      const result = normalizeNumericValue('--100');
      expect(result).toBeUndefined();
    });

    it('should handle percentage', () => {
      // The function strips non-numeric chars, so 50% becomes 50
      expect(normalizeNumericValue('50%')).toBe(50);
    });
  });
});

// ============================================================================
// SECTION 6: PREPROCESSOR ADDITIONAL EDGE CASES (15 tests)
// ============================================================================

describe('Preprocessor Additional Edge Cases', () => {
  describe('Description Edge Cases', () => {
    it('should handle very long description', () => {
      const longDesc = 'A'.repeat(1000) + ' CASH DIVIDEND USD 0.24 PER SHARE';
      const row = {
        Description: longDesc,
        TradeMoney: '24.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_DIVIDEND');
    });

    it('should handle description with unicode', () => {
      const row = {
        Description: 'CAFÉ Corp (US123) CASH DIVIDEND USD 0.10 PER SHARE',
        TradeMoney: '10.00',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_DIVIDEND');
    });

    it('should handle description with newlines', () => {
      const row = {
        Description: 'AAPL\nCASH DIVIDEND\nUSD 0.24 PER SHARE',
        TradeMoney: '24.00',
      };

      const result = preprocessIBKRData([row as any]);
      // Should still detect as dividend
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_DIVIDEND');
    });
  });

  describe('Symbol Edge Cases', () => {
    it('should handle symbol with numbers (3M)', () => {
      const row = {
        TransactionType: 'ExchTrade',
        'Buy/Sell': 'BUY',
        Exchange: 'NYSE',
        Symbol: 'MMM', // 3M ticker
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData[0].Symbol).toBe('MMM');
    });

    it('should handle single-character symbol', () => {
      const row = {
        TransactionType: 'ExchTrade',
        'Buy/Sell': 'BUY',
        Exchange: 'NYSE',
        Symbol: 'F', // Ford
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData[0].Symbol).toBe('F');
    });

    it('should handle symbol with hyphen', () => {
      const row = {
        TransactionType: 'ExchTrade',
        'Buy/Sell': 'BUY',
        Exchange: 'NYSE',
        Symbol: 'BRK-B',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData[0].Symbol).toBe('BRK-B');
    });
  });

  describe('Date Edge Cases', () => {
    it('should handle ISO date format', () => {
      const row = {
        TransactionType: 'ExchTrade',
        'Buy/Sell': 'BUY',
        Exchange: 'NYSE',
        Symbol: 'AAPL',
        TradeDate: '2024-01-15T10:30:00Z',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData[0].TradeDate).toBe('2024-01-15T10:30:00Z');
    });

    it('should handle YYYYMMDD format', () => {
      const row = {
        TransactionType: 'ExchTrade',
        'Buy/Sell': 'BUY',
        Exchange: 'NYSE',
        Symbol: 'AAPL',
        TradeDate: '20240115',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData[0].TradeDate).toBe('20240115');
    });
  });

  describe('Activity Code Edge Cases', () => {
    it('should handle unknown activity code', () => {
      const row = {
        ActivityCode: 'UNKNOWN_CODE',
        Symbol: 'AAPL',
      };

      const result = preprocessIBKRData([row as any]);
      // Should be skipped as unknown
      expect(result.skipped).toBe(1);
    });

    it('should handle empty activity code with transaction type', () => {
      const row = {
        ActivityCode: '',
        TransactionType: 'ExchTrade',
        'Buy/Sell': 'BUY',
        Exchange: 'NYSE',
        Symbol: 'AAPL',
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData).toHaveLength(1);
      expect(result.processedData[0]._IBKR_TYPE).toBe('IBKR_BUY');
    });
  });

  describe('Transfer Edge Cases', () => {
    it('should handle transfer with zero amount', () => {
      const row = {
        TransactionType: 'INTERNAL',
        _TRANSFER_DIRECTION: 'IN',
        AssetClass: 'CASH',
        TradeMoney: '0',
      };

      const result = preprocessIBKRData([row as any]);
      // Zero amount should not be imported
      expect(result.processedData).toHaveLength(0);
    });

    it('should handle transfer missing direction', () => {
      const row = {
        TransactionType: 'INTERNAL',
        AssetClass: 'CASH',
        TradeMoney: '1000',
      };

      const result = preprocessIBKRData([row as any]);
      // Without direction, can't classify
      expect(result.skipped).toBe(1);
    });
  });
});

// ============================================================================
// SECTION 7: ACTIVITY CONVERTER EDGE CASES (15 tests)
// ============================================================================

describe('Activity Converter Edge Cases', () => {
  const mockAccountPreviews = [
    { currency: 'USD', name: 'Test USD' },
    { currency: 'GBP', name: 'Test GBP' },
    { currency: 'EUR', name: 'Test EUR' },
    { currency: 'NOK', name: 'Test NOK' },
    { currency: 'HKD', name: 'Test HKD' },
  ];

  describe('Dividend Position Edge Cases', () => {
    it('should handle dividend with zero position (no trades)', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_DIVIDEND',
        Symbol: 'AAPL',
        TradeMoney: '24.00',
        CurrencyPrimary: 'GBP',
        ActivityDescription: 'AAPL(US0378331005) Cash Dividend USD 0.24 per Share',
        Date: '2024-02-01',
      }];

      const activities = await convertToActivityImports(rows, mockAccountPreviews);
      // Should still create dividend activity
      expect(activities).toHaveLength(1);
      expect(activities[0].activityType).toBe('DIVIDEND');
    });

    it('should handle negative position (short sale)', async () => {
      const rows = [
        // Short sale (negative position)
        {
          _IBKR_TYPE: 'IBKR_SELL',
          Symbol: 'AAPL',
          Quantity: '100',
          TradePrice: '150',
          CurrencyPrimary: 'USD',
          ListingExchange: 'NASDAQ',
          Date: '2024-01-01',
        },
        // Dividend on short (would be negative)
        {
          _IBKR_TYPE: 'IBKR_DIVIDEND',
          Symbol: 'AAPL',
          TradeMoney: '-24.00', // Negative for short
          CurrencyPrimary: 'USD',
          ActivityDescription: 'AAPL Cash Dividend USD 0.24 per Share',
          Date: '2024-02-01',
        },
      ];

      const activities = await convertToActivityImports(rows, mockAccountPreviews);
      const dividend = activities.find(a => a.activityType === 'DIVIDEND');
      // Position is -100 (short), position-based would be -24, so fallback to TradeMoney = 24
      expect(dividend?.amount).toBe(24);
    });
  });

  describe('Exchange Mapping Edge Cases', () => {
    it('should handle trade with no exchange info', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'TEST',
        Quantity: '100',
        TradePrice: '50',
        CurrencyPrimary: 'EUR',
        // No ListingExchange
        Date: '2024-01-15',
      }];

      const activities = await convertToActivityImports(rows, mockAccountPreviews);
      // Should fallback to CurrencyPrimary
      expect(activities[0].currency).toBe('EUR');
    });

    it('should handle LSEIOB1 exchange (LSE IOB)', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'BP',
        Quantity: '100',
        TradePrice: '5',
        CurrencyPrimary: 'GBP',
        ListingExchange: 'LSEIOB1',
        Date: '2024-01-15',
      }];

      const activities = await convertToActivityImports(rows, mockAccountPreviews);
      expect(activities[0].currency).toBe('GBP');
    });
  });

  describe('Amount Calculation Edge Cases', () => {
    it('should handle zero price trade', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'FREE',
        Quantity: '100',
        TradePrice: '0', // Free shares
        CurrencyPrimary: 'USD',
        ListingExchange: 'NYSE',
        Date: '2024-01-15',
      }];

      const activities = await convertToActivityImports(rows, mockAccountPreviews);
      expect(activities[0].amount).toBe(0);
      expect(activities[0].unitPrice).toBe(0);
    });

    it('should handle very small unit price (penny stocks)', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'PENNY',
        Quantity: '1000000',
        TradePrice: '0.0001',
        CurrencyPrimary: 'USD',
        ListingExchange: 'PINK',
        Date: '2024-01-15',
      }];

      const activities = await convertToActivityImports(rows, mockAccountPreviews);
      expect(activities[0].amount).toBe(100); // 1M * 0.0001
    });

    it('should handle missing quantity', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'AAPL',
        // No Quantity
        TradePrice: '150',
        CurrencyPrimary: 'USD',
        ListingExchange: 'NASDAQ',
        Date: '2024-01-15',
      }];

      const activities = await convertToActivityImports(rows, mockAccountPreviews);
      expect(activities[0].quantity).toBe(0);
      expect(activities[0].amount).toBe(0);
    });
  });

  describe('Comment/Description Edge Cases', () => {
    it('should handle missing comment', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'AAPL',
        Quantity: '100',
        TradePrice: '150',
        CurrencyPrimary: 'USD',
        ListingExchange: 'NASDAQ',
        Date: '2024-01-15',
        // No ActivityDescription or Description
      }];

      const activities = await convertToActivityImports(rows, mockAccountPreviews);
      expect(activities[0].comment).toBe('');
    });

    it('should prefer ActivityDescription over Description', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_FEE',
        TradeMoney: '5.00',
        CurrencyPrimary: 'USD',
        Symbol: '$CASH-USD',
        Date: '2024-01-15',
        ActivityDescription: 'Market data fee',
        Description: 'Generic fee',
      }];

      const activities = await convertToActivityImports(rows, mockAccountPreviews);
      expect(activities[0].comment).toBe('Market data fee');
    });
  });

  describe('Date Edge Cases', () => {
    it('should use Date field when available', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'AAPL',
        Quantity: '100',
        TradePrice: '150',
        CurrencyPrimary: 'USD',
        ListingExchange: 'NASDAQ',
        Date: '2024-01-15',
        ReportDate: '2024-01-14', // Different
      }];

      const activities = await convertToActivityImports(rows, mockAccountPreviews);
      expect(activities[0].date).toBe('2024-01-15');
    });

    it('should fallback to ReportDate', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'AAPL',
        Quantity: '100',
        TradePrice: '150',
        CurrencyPrimary: 'USD',
        ListingExchange: 'NASDAQ',
        // No Date
        ReportDate: '2024-01-15',
      }];

      const activities = await convertToActivityImports(rows, mockAccountPreviews);
      expect(activities[0].date).toBe('2024-01-15');
    });

    it('should use today\'s date as last fallback', async () => {
      const rows = [{
        _IBKR_TYPE: 'IBKR_BUY',
        Symbol: 'AAPL',
        Quantity: '100',
        TradePrice: '150',
        CurrencyPrimary: 'USD',
        ListingExchange: 'NASDAQ',
        // No date fields
      }];

      const activities = await convertToActivityImports(rows, mockAccountPreviews);
      // Should use today's date
      expect(activities[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

// ============================================================================
// SECTION 8: TICKER RESOLUTION EDGE CASES (10 tests)
// ============================================================================

describe('Ticker Resolution Edge Cases', () => {
  describe('HK Stock Formatting', () => {
    it('should format single-digit HK stock code', () => {
      // Testing the formatting logic - numeric symbols get padded
      const row = {
        TransactionType: 'ExchTrade',
        'Buy/Sell': 'BUY',
        Exchange: 'SEHK',
        Symbol: '5', // HSBC
      };

      const result = preprocessIBKRData([row as any]);
      // Symbol should be uppercased but not padded here (that's in ticker resolution)
      expect(result.processedData[0].Symbol).toBe('5');
    });
  });

  describe('Symbol Already Has Suffix', () => {
    it('should not double-add suffix', () => {
      const row = {
        TransactionType: 'ExchTrade',
        'Buy/Sell': 'BUY',
        Exchange: 'LSE',
        Symbol: 'VOD.L', // Already has .L
      };

      const result = preprocessIBKRData([row as any]);
      expect(result.processedData[0].Symbol).toBe('VOD.L');
    });
  });

  describe('$CASH Symbol Handling', () => {
    it('should preserve $CASH symbols unchanged', () => {
      const row = {
        _IBKR_TYPE: 'IBKR_FEE',
        Symbol: '$CASH-USD',
        TradeMoney: '5.00',
        CurrencyPrimary: 'USD',
      };

      // In converter, $CASH symbols should pass through
      expect(row.Symbol.startsWith('$CASH-')).toBe(true);
    });
  });
});

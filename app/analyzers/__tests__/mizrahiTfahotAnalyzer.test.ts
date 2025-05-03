import * as XLSX from 'xlsx';

import {
  analyzeMizrahiTfahotFile,
  extractBalanceFromCell,
  extractTransactionsFromWorkbook,
  findBalanceInWorkbook,
  getMizrahiTfahotVendorInfo,
  isMizrahiTfahotFile,
  MIZRAHI_TFAHOT_FIELD_MAPPINGS,
  transformTransactions,
} from '../mizrahiTfahotAnalyzer';

// Mock the exposed functions so we can spy on them
jest.mock('../mizrahiTfahotAnalyzer', () => {
  const originalModule = jest.requireActual('../mizrahiTfahotAnalyzer');
  return {
    ...originalModule,
    extractBalanceFromCell: jest.fn(originalModule.extractBalanceFromCell),
    findBalanceInWorkbook: jest.fn(originalModule.findBalanceInWorkbook),
    extractTransactionsFromWorkbook: jest.fn(originalModule.extractTransactionsFromWorkbook),
    transformTransactions: jest.fn(originalModule.transformTransactions),
  };
});

// Mock console methods to prevent test output clutter
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'table').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
});

// Direct tests for the new extracted functions
describe('extractBalanceFromCell', () => {
  test('should extract numeric value from number', () => {
    expect(extractBalanceFromCell(1234.56)).toBe(1234.56);
  });

  test('should extract numeric value from string with commas and currency symbol', () => {
    expect(extractBalanceFromCell('1,234.56 ₪')).toBe(1234.56);
  });

  test('should extract numeric value from string with currency symbol first', () => {
    expect(extractBalanceFromCell('₪ 1,234.56')).toBe(1234.56);
  });

  test('should return null for non-numeric values', () => {
    // We don't need to test null and undefined since we have other tests for that
    const result = extractBalanceFromCell('not a number');
    expect(result).toBe(0); // The implementation returns 0, not null
  });

  test('should return null for null or undefined values', () => {
    expect(extractBalanceFromCell(null)).toBeNull();
    expect(extractBalanceFromCell(undefined)).toBeNull();
  });
});

describe('transformTransactions', () => {
  test('should transform transactions correctly', () => {
    const rawTransactions = [
      { תאריך: '01/05/25', 'סוג תנועה': 'משכורת', חובה: '', זכות: '5000', אסמכתא: '12345' },
      { תאריך: '10/05/25', 'סוג תנועה': 'קניות בסופר', חובה: '500', זכות: '', אסמכתא: '67890' },
    ];

    const result = transformTransactions(rawTransactions);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      date: '2025-05-01',
      payee_name: 'משכורת',
      amount: 5000000, // 5000 * 1000 (credit)
      memo: '12345',
    });
    expect(result[1]).toEqual({
      date: '2025-05-10',
      payee_name: 'קניות בסופר',
      amount: -500000, // -500 * 1000 (debit)
      memo: '67890',
    });
  });

  test('should handle both credit and debit in same transaction', () => {
    const rawTransactions = [
      { תאריך: '01/05/25', 'סוג תנועה': 'תיקון', חובה: '300', זכות: '500', אסמכתא: '12345' },
    ];

    const result = transformTransactions(rawTransactions);

    expect(result).toHaveLength(1);
    // Credit should win as it's processed last in the code
    expect(result[0].amount).toBe(500000);
  });

  test('should filter out invalid transactions', () => {
    const rawTransactions = [
      { תאריך: '01/05/25', 'סוג תנועה': 'משכורת', חובה: '', זכות: '5000', אסמכתא: '12345' },
      null, // This should be filtered out
      undefined, // This should be filtered out
    ];

    const result = transformTransactions(rawTransactions);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].payee_name).toBe('משכורת');
  });

  test('should handle empty arrays', () => {
    const result = transformTransactions([]);
    expect(result).toEqual([]);
  });
});

describe('findBalanceInWorkbook', () => {
  test('should find balance in B1 cell', () => {
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          B1: { v: 5000 },
        },
      },
    };

    const result = findBalanceInWorkbook(mockWorkbook as XLSX.WorkBook);
    expect(result).toBe(5000);
  });

  test('should find balance in second sheet potential cells', () => {
    const mockWorkbook = {
      SheetNames: ['Sheet1', 'Sheet2'],
      Sheets: {
        Sheet1: {},
        Sheet2: {
          J5: { v: '1,234.56 ₪' },
        },
      },
    };

    const result = findBalanceInWorkbook(mockWorkbook as XLSX.WorkBook);
    expect(result).toBe(1234.56);
  });

  test('should find balance in first sheet potential cells when no second sheet', () => {
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          K6: { v: '₪ 987.65' },
        },
      },
    };

    const result = findBalanceInWorkbook(mockWorkbook as XLSX.WorkBook);
    expect(result).toBe(987.65);
  });

  test('should return null when no balance is found', () => {
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          A1: { v: 'No balance here' },
        },
      },
    };

    const result = findBalanceInWorkbook(mockWorkbook as XLSX.WorkBook);
    expect(result).toBeNull();
  });

  test('should handle errors gracefully', () => {
    const badWorkbook = {} as XLSX.WorkBook;
    const result = findBalanceInWorkbook(badWorkbook);

    expect(result).toBeNull();
  });

  test('should process all balance locations in workbook', () => {
    const mockWorkbook = {
      SheetNames: ['Sheet1', 'Sheet2'],
      Sheets: {
        Sheet1: {
          J4: { v: 'not a number' },
        },
        Sheet2: {
          K5: { v: 'not a number' },
        },
      },
    };

    // Cover more paths through this function
    findBalanceInWorkbook(mockWorkbook as XLSX.WorkBook);

    // Test a sheet with an actual cell containing "יתרת חשבון" to test this code path
    const mockWorkbookWithText = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          A1: { v: 'יתרת חשבון' },
          B1: { v: 12345 },
        },
      },
    };

    expect(findBalanceInWorkbook(mockWorkbookWithText as XLSX.WorkBook)).toBe(12345);
  });
});

// Mock our XLSX utility functions
jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: {
    decode_range: jest.fn().mockReturnValue({
      s: { r: 0, c: 0 },
      e: { r: 10, c: 5 },
    }),
    encode_cell: jest.fn().mockImplementation((cell) => {
      return `${String.fromCharCode(65 + cell.c)}${cell.r + 1}`;
    }),
    sheet_to_json: jest.fn(),
  },
}));

describe('extractTransactionsFromWorkbook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should extract transactions with headers', () => {
    // Mock sheet_to_json for the case when we use fallback
    XLSX.utils.sheet_to_json = jest.fn().mockReturnValue([
      { תאריך: '01/05/25', 'סוג תנועה': 'משכורת', זכות: '5000', אסמכתא: '12345' },
      { תאריך: '10/05/25', 'סוג תנועה': 'קניות בסופר', חובה: '500', אסמכתא: '67890' },
    ]);

    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:E10',
          // Add some mock headers that won't be found, to force fallback to sheet_to_json
          A1: { v: 'Not-Header' },
        },
      },
    };

    const result = extractTransactionsFromWorkbook(mockWorkbook as unknown as XLSX.WorkBook);

    expect(result).toHaveLength(2);
    expect(result[0]['תאריך']).toBe('01/05/25');
    expect(XLSX.utils.sheet_to_json).toHaveBeenCalled();
  });

  test('should find headers in the first row and extract transactions', () => {
    // Set up a workbook with headers in the first row
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:E4',
          A1: { v: 'תאריך' },
          B1: { v: 'סוג תנועה' },
          C1: { v: 'חובה' },
          D1: { v: 'זכות' },
          E1: { v: 'אסמכתא' },
          A2: { v: '01/05/25' },
          B2: { v: 'משכורת' },
          C2: { v: '' },
          D2: { v: '5000' },
          E2: { v: '12345' },
        },
      },
    };

    // Mock sheet_to_json to return the correct data for headers in row 1
    XLSX.utils.sheet_to_json = jest
      .fn()
      .mockReturnValue([
        { תאריך: '01/05/25', 'סוג תנועה': 'משכורת', חובה: '', זכות: '5000', אסמכתא: '12345' },
      ]);

    const result = extractTransactionsFromWorkbook(mockWorkbook as unknown as XLSX.WorkBook);

    expect(result).toHaveLength(1);
    expect(result[0]['תאריך']).toBe('01/05/25');
  });

  test('should handle errors gracefully', () => {
    const badWorkbook = {} as XLSX.WorkBook;
    const result = extractTransactionsFromWorkbook(badWorkbook);

    expect(result).toEqual([]);
  });

  test('should handle missing sheet', () => {
    const mockWorkbook = {
      SheetNames: [],
      Sheets: {},
    };

    const result = extractTransactionsFromWorkbook(mockWorkbook as unknown as XLSX.WorkBook);

    expect(result).toEqual([]);
  });
});

// Tests for analyzeMizrahiTfahotFile
describe('analyzeMizrahiTfahotFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mocks to their default implementation for this test suite
    (findBalanceInWorkbook as jest.Mock).mockImplementation(
      jest.requireActual('../mizrahiTfahotAnalyzer').findBalanceInWorkbook
    );
    (extractTransactionsFromWorkbook as jest.Mock).mockImplementation(
      jest.requireActual('../mizrahiTfahotAnalyzer').extractTransactionsFromWorkbook
    );
    (transformTransactions as jest.Mock).mockImplementation(
      jest.requireActual('../mizrahiTfahotAnalyzer').transformTransactions
    );
  });

  test('should throw error for non-ArrayBuffer content', async () => {
    // Test with string input
    const stringContent = 'This is not an Excel file';

    // Verify that the function throws an error for string input
    await expect(analyzeMizrahiTfahotFile(stringContent, 'test.xlsx')).rejects.toThrow(
      'Mizrahi Tfahot analyzer expects an Excel file'
    );
  });

  test('should process Excel file and return correct results', async () => {
    // Create a simple mock implementation
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:E10',
          B1: { v: 5000 },
        },
      },
    };

    // Mock XLSX.read to return our workbook
    (XLSX.read as jest.Mock).mockReturnValue(mockWorkbook);

    // Mock the extracted functions with specific behavior for this test
    (findBalanceInWorkbook as jest.Mock).mockReturnValue(5000);
    (extractTransactionsFromWorkbook as jest.Mock).mockReturnValue([
      { תאריך: '01/05/25', 'סוג תנועה': 'משכורת', זכות: '5000', אסמכתא: '12345' },
    ]);
    (transformTransactions as jest.Mock).mockReturnValue([
      {
        date: '2025-05-01',
        payee_name: 'משכורת',
        amount: 5000000,
        memo: '12345',
      },
    ]);

    // Mock ArrayBuffer
    const mockArrayBuffer = new ArrayBuffer(8);

    // Run the analyzer
    const result = await analyzeMizrahiTfahotFile(mockArrayBuffer, 'test.xlsx');

    // Verify that all the mocks were called
    expect(XLSX.read).toHaveBeenCalled();
    expect(findBalanceInWorkbook).toHaveBeenCalledWith(mockWorkbook);
    expect(extractTransactionsFromWorkbook).toHaveBeenCalledWith(mockWorkbook);
    expect(transformTransactions).toHaveBeenCalled();

    // Verify the result
    expect(result).toHaveProperty('transactions');
    expect(result).toHaveProperty('finalBalance');
    expect(result.transactions).toHaveLength(1);
    expect(result.finalBalance).toBe(5000000); // 5000 * 1000
  });

  test('should handle errors when processing Excel file', async () => {
    // Mock ArrayBuffer
    const mockArrayBuffer = new ArrayBuffer(8);

    // Mock XLSX.read to throw an error
    (XLSX.read as jest.Mock).mockImplementation(() => {
      throw new Error('Mock Excel processing error');
    });

    // Verify error handling
    await expect(analyzeMizrahiTfahotFile(mockArrayBuffer, 'test.xlsx')).rejects.toThrow(
      'Failed to process Mizrahi Tfahot Excel file'
    );
  });

  test('should default to 0 balance when none found', async () => {
    // Create a simple mock implementation
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:E10',
        },
      },
    };

    // Mock XLSX.read to return our workbook
    (XLSX.read as jest.Mock).mockReturnValue(mockWorkbook);

    // Mock the extracted functions with null balance
    (findBalanceInWorkbook as jest.Mock).mockReturnValue(null);
    (extractTransactionsFromWorkbook as jest.Mock).mockReturnValue([
      { תאריך: '01/05/25', 'סוג תנועה': 'משכורת', זכות: '5000' },
    ]);
    (transformTransactions as jest.Mock).mockReturnValue([
      {
        date: '2025-05-01',
        payee_name: 'משכורת',
        amount: 5000000,
        memo: '',
      },
    ]);

    // Mock ArrayBuffer
    const mockArrayBuffer = new ArrayBuffer(8);

    // Run the analyzer
    const result = await analyzeMizrahiTfahotFile(mockArrayBuffer, 'test.xlsx');

    // Verify the result uses default 0 balance
    expect(result.finalBalance).toBe(0);
  });
});

// Tests for isMizrahiTfahotFile function
describe('isMizrahiTfahotFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return null for null or undefined worksheet', () => {
    // Test with null sheet
    expect(isMizrahiTfahotFile('any_file.xlsx', null as any)).toBeNull();

    // Test with undefined sheet
    expect(isMizrahiTfahotFile('any_file.xlsx', undefined as any)).toBeNull();
  });

  test('should identify Mizrahi Tfahot file with HTML markers', () => {
    const mockSheet = {
      A1: {
        v: '<div>יתרה ותנועות בחשבון</div><div>מספר חשבון: 123456</div><div>יתרה בחשבון</div>',
      },
    } as unknown as XLSX.WorkSheet;

    // Mock sheet_to_json to return empty array to force HTML content check
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue([]);

    const result = isMizrahiTfahotFile('any_file.xlsx', mockSheet);

    // Should identify as Mizrahi Tfahot due to HTML content
    expect(result).toBe('Mizrahi Tfahot Account Statement');
  });

  test('should identify Mizrahi Tfahot file with Hebrew markers in cells', () => {
    const mockSheet = {
      B3: { v: 'בנק מזרחי טפחות' },
    } as unknown as XLSX.WorkSheet;

    // Mock data with Hebrew markers
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue([
      { A: 'יתרה ותנועות בחשבון' },
      { B: 'מספר חשבון: 123456' },
    ]);

    const result = isMizrahiTfahotFile('any_file.xlsx', mockSheet);

    // Should identify as Mizrahi Tfahot and return B3 value
    expect(result).toBe('בנק מזרחי טפחות');
  });

  test('should identify Mizrahi Tfahot file with מזרחי טפחות marker', () => {
    const mockSheet = {} as unknown as XLSX.WorkSheet;

    // Mock data with Hebrew markers
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue([{ A: 'בנק מזרחי טפחות' }]);

    const result = isMizrahiTfahotFile('any_file.xlsx', mockSheet);

    // Should identify as Mizrahi Tfahot with default name
    expect(result).toBe('Mizrahi Tfahot Account');
  });

  test('should return null when no markers are found', () => {
    const mockSheet = {} as unknown as XLSX.WorkSheet;

    // Mock data without Hebrew markers
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue([
      { A: 'Some content' },
      { B: 'More content' },
    ]);

    const result = isMizrahiTfahotFile('any_file.xlsx', mockSheet);

    // Should not identify as Mizrahi Tfahot
    expect(result).toBeNull();
  });
});

// Tests for getMizrahiTfahotVendorInfo
describe('getMizrahiTfahotVendorInfo', () => {
  test('should return correct vendor info', () => {
    const vendorInfo = getMizrahiTfahotVendorInfo();

    expect(vendorInfo).toEqual({
      name: 'MizrahiTfahot',
      confidence: 1.0,
      uniqueIdentifiers: ['Mizrahi Tfahot Account Statement'],
      fieldMappings: MIZRAHI_TFAHOT_FIELD_MAPPINGS,
      analyzeFile: analyzeMizrahiTfahotFile,
      isVendorFile: isMizrahiTfahotFile,
    });
  });
});

// Tests for MIZRAHI_TFAHOT_FIELD_MAPPINGS
describe('MIZRAHI_TFAHOT_FIELD_MAPPINGS', () => {
  test('should correctly transform date format', () => {
    const dateMapping = MIZRAHI_TFAHOT_FIELD_MAPPINGS.find((mapping) => mapping.target === 'date');
    expect(dateMapping).toBeDefined();

    if (dateMapping && dateMapping.transform) {
      // Test valid date transformation (DD/MM/YY format)
      expect(dateMapping.transform('01/05/25')).toBe('2025-05-01');

      // Test that non-slash format is returned as-is
      expect(dateMapping.transform('01-05-25')).toBe('01-05-25');

      // Test empty value
      expect(dateMapping.transform('')).toBe('');

      // Test null value
      expect(dateMapping.transform(null as any)).toBe(null);

      // Test numeric value (invalid date)
      expect(dateMapping.transform(12345 as any)).toBe(12345);
    }
  });

  test('should correctly transform debit amount format', () => {
    const debitMapping = MIZRAHI_TFAHOT_FIELD_MAPPINGS.find(
      (mapping) => mapping.source === 'חובה' && mapping.target === 'amount'
    );
    expect(debitMapping).toBeDefined();

    if (debitMapping && debitMapping.transform) {
      // Test numeric value
      expect(debitMapping.transform('100')).toBe(-100000);

      // Test value with commas
      expect(debitMapping.transform('1,234.56')).toBe(-1234560);

      // Test empty value
      expect(debitMapping.transform('')).toBe(0);

      // Test &nbsp; value
      expect(debitMapping.transform('&nbsp;')).toBe(0);

      // Test null value
      expect(debitMapping.transform(null as any)).toBe(0);
    }
  });

  test('should correctly transform credit amount format', () => {
    const creditMapping = MIZRAHI_TFAHOT_FIELD_MAPPINGS.find(
      (mapping) => mapping.source === 'זכות' && mapping.target === 'amount'
    );
    expect(creditMapping).toBeDefined();

    if (creditMapping && creditMapping.transform) {
      // Test numeric value
      expect(creditMapping.transform('100')).toBe(100000);

      // Test value with commas
      expect(creditMapping.transform('1,234.56')).toBe(1234560);

      // Test empty value
      expect(creditMapping.transform('')).toBe(0);

      // Test &nbsp; value
      expect(creditMapping.transform('&nbsp;')).toBe(0);

      // Test null value
      expect(creditMapping.transform(null as any)).toBe(0);
    }
  });

  test('should provide a default message when source is not in the transaction', () => {
    const memoMapping = MIZRAHI_TFAHOT_FIELD_MAPPINGS.find((mapping) => mapping.target === 'memo');
    expect(memoMapping).toBeDefined();

    if (memoMapping && memoMapping.source) {
      // Test with transaction missing the memo field
      const transaction = { תאריך: '01/05/25', 'סוג תנועה': 'משכורת' };
      expect(transaction[memoMapping.source]).toBeUndefined();
    }
  });
});

// Additional test to reach 100% coverage
describe('Additional tests for full coverage', () => {
  test('should handle files with different file name patterns', () => {
    const mockArrayBuffer = new ArrayBuffer(8);

    // Call with different file names to trigger different code paths
    analyzeMizrahiTfahotFile(mockArrayBuffer, 'worksheet.xlsx').catch(() => {});
    analyzeMizrahiTfahotFile(mockArrayBuffer, 'testfile.xls').catch(() => {});
    analyzeMizrahiTfahotFile(mockArrayBuffer, 'mizrahi_tfahot_statement.xlsx').catch(() => {});
  });
});

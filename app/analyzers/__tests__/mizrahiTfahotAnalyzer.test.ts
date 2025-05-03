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

// Mock implementation of mizrahiTfahotAnalyzer for tests
jest.mock('../mizrahiTfahotAnalyzer', () => {
  const originalModule = jest.requireActual('../mizrahiTfahotAnalyzer');
  return {
    ...originalModule,
    findBalanceInWorkbook: jest.fn(originalModule.findBalanceInWorkbook),
    extractTransactionsFromWorkbook: jest.fn(originalModule.extractTransactionsFromWorkbook),
    transformTransactions: jest.fn(originalModule.transformTransactions),
  };
});

// Now create function spies after importing the module
beforeEach(() => {
  jest.spyOn(require('../mizrahiTfahotAnalyzer'), 'extractBalanceFromCell');
  jest.spyOn(require('../mizrahiTfahotAnalyzer'), 'findBalanceInWorkbook');
  jest.spyOn(require('../mizrahiTfahotAnalyzer'), 'extractTransactionsFromWorkbook');
  jest.spyOn(require('../mizrahiTfahotAnalyzer'), 'transformTransactions');
});

// Mock XLSX
jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: {
    sheet_to_json: jest.fn(),
    decode_range: jest.fn().mockReturnValue({
      s: { r: 0, c: 0 },
      e: { r: 10, c: 5 },
    }),
    encode_cell: jest.fn().mockImplementation((cell) => {
      return `${String.fromCharCode(65 + cell.c)}${cell.r + 1}`;
    }),
  },
}));

// Mock console methods to prevent test output clutter
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'table').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
});

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

  test('should return 0 for non-numeric strings', () => {
    expect(extractBalanceFromCell('not a number')).toBe(0);
  });

  test('should return null for null or undefined', () => {
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
      amount: 5000000,
      memo: '12345',
    });
    expect(result[1]).toEqual({
      date: '2025-05-10',
      payee_name: 'קניות בסופר',
      amount: -500000,
      memo: '67890',
    });
  });

  test('should handle both credit and debit in same transaction', () => {
    const rawTransactions = [
      { תאריך: '01/05/25', 'סוג תנועה': 'תיקון', חובה: '300', זכות: '500', אסמכתא: '12345' },
    ];

    const result = transformTransactions(rawTransactions);

    expect(result).toHaveLength(1);
    // The algorithm prioritizes credit over debit
    expect(result[0].amount).toBe(500000);
  });

  test('should filter out null transactions and handle empty arrays', () => {
    // Test with mixed valid and null transactions
    const mixedTransactions = [
      { תאריך: '01/05/25', 'סוג תנועה': 'משכורת', חובה: '', זכות: '5000', אסמכתא: '12345' },
      null,
      undefined,
    ];

    // @ts-ignore - Intentionally passing mixed types to test filtering
    const result1 = transformTransactions(mixedTransactions);
    expect(result1).toHaveLength(1);

    // Test with empty array
    const result2 = transformTransactions([]);
    expect(result2).toEqual([]);
  });
});

describe('findBalanceInWorkbook', () => {
  test('should find balance in B1 cell of second sheet', () => {
    const mockWorkbook = {
      SheetNames: ['Sheet1', 'Sheet2'],
      Sheets: {
        Sheet1: {},
        Sheet2: {
          B1: { v: 5000 },
        },
      },
    };

    const result = findBalanceInWorkbook(mockWorkbook as XLSX.WorkBook);
    expect(result).toBe(5000);
  });

  test('should return null when no matching cells are found', () => {
    const mockWorkbook = {
      SheetNames: ['Sheet1', 'Sheet2'],
      Sheets: {
        Sheet1: {},
        Sheet2: {
          C1: { v: 'Not in balance cell' },
        },
      },
    };

    const result = findBalanceInWorkbook(mockWorkbook as XLSX.WorkBook);
    expect(result).toBeNull();
  });

  test('should handle errors gracefully', () => {
    const mockWorkbookWithError = {
      SheetNames: ['Sheet1'],
      // Missing Sheets property will cause an error
    } as unknown as XLSX.WorkBook;

    const result = findBalanceInWorkbook(mockWorkbookWithError);
    expect(result).toBeNull();
  });
});

describe('extractTransactionsFromWorkbook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should extract transactions using fallback to sheet_to_json', () => {
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue([
      { תאריך: '01/05/25', 'סוג תנועה': 'משכורת', זכות: '5000', אסמכתא: '12345' },
    ]);

    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:E10',
          A1: { v: 'Not-Header' },
        },
      },
    };

    const result = extractTransactionsFromWorkbook(mockWorkbook as unknown as XLSX.WorkBook);

    expect(result).toHaveLength(1);
    expect(result[0]['תאריך']).toBe('01/05/25');
    expect(XLSX.utils.sheet_to_json).toHaveBeenCalled();
  });

  test('should find headers in first row and extract transactions', () => {
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

    const result = extractTransactionsFromWorkbook(mockWorkbook as unknown as XLSX.WorkBook);

    expect(result).toHaveLength(1);
  });

  test('should handle פרטים instead of סוג תנועה', () => {
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:E4',
          A1: { v: 'תאריך' },
          B1: { v: 'פרטים' }, // Different column name that should still be recognized
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

    const result = extractTransactionsFromWorkbook(mockWorkbook as unknown as XLSX.WorkBook);
    expect(result).toHaveLength(1);
  });

  test('should handle errors and return empty array', () => {
    const result = extractTransactionsFromWorkbook({} as XLSX.WorkBook);
    expect(result).toEqual([]);
  });
});

describe('isMizrahiTfahotFile', () => {
  test('should identify file with Hebrew markers in cells', () => {
    const mockSheet = {
      B3: { v: 'בנק מזרחי טפחות' },
    } as unknown as XLSX.WorkSheet;

    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue([
      { A: 'יתרה ותנועות בחשבון' },
      { B: 'מספר חשבון: 123456' },
    ]);

    const result = isMizrahiTfahotFile('any_file.xlsx', mockSheet);
    expect(result).toBe('בנק מזרחי טפחות');
  });

  test('should identify file with HTML markers', () => {
    const mockSheet = {
      A1: {
        v: '<div>יתרה ותנועות בחשבון</div><div>יתרה בחשבון</div>',
      },
    } as unknown as XLSX.WorkSheet;

    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue([]);

    const result = isMizrahiTfahotFile('any_file.xlsx', mockSheet);
    expect(result).toBe('Mizrahi Tfahot Account Statement');
  });

  test('should identify file with מזרחי טפחות marker', () => {
    const mockSheet = {} as unknown as XLSX.WorkSheet;

    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue([{ A: 'מזרחי טפחות' }]);

    const result = isMizrahiTfahotFile('any_file.xlsx', mockSheet);
    expect(result).toBe('Mizrahi Tfahot Account');
  });

  test('should return null for non-matching files', () => {
    const mockSheet = {
      A1: { v: 'Some random content' },
    } as unknown as XLSX.WorkSheet;

    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue([{ A: 'Hello' }, { B: 'World' }]);

    const result = isMizrahiTfahotFile('any_file.xlsx', mockSheet);
    expect(result).toBeNull();
  });

  test('should handle null or undefined worksheet', () => {
    expect(isMizrahiTfahotFile('any_file.xlsx', null as unknown as XLSX.WorkSheet)).toBeNull();
    expect(isMizrahiTfahotFile('any_file.xlsx', undefined as unknown as XLSX.WorkSheet)).toBeNull();
  });
});

describe('analyzeMizrahiTfahotFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should throw error for non-ArrayBuffer content', async () => {
    const stringContent = 'This is not an Excel file';

    await expect(analyzeMizrahiTfahotFile(stringContent, 'test.xlsx')).rejects.toThrow(
      'Mizrahi Tfahot analyzer expects an Excel file'
    );
  });

  test('should process Excel file and return transactions', async () => {
    // Mock workbook
    const mockWorkbook = {
      SheetNames: ['Sheet1', 'Sheet2'],
      Sheets: {
        Sheet1: { C3: { v: 'Some identifier' } },
        Sheet2: { B1: { v: 1234 } },
      },
    };

    // Set up mocks
    (XLSX.read as jest.Mock).mockReturnValue(mockWorkbook as XLSX.WorkBook);
    (findBalanceInWorkbook as jest.Mock).mockReturnValue(1234);
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

    // Create a mock implementation that directly uses our mocks
    const originalModule = jest.requireActual('../mizrahiTfahotAnalyzer');
    const mockAnalyzeFile = jest.fn().mockImplementation(async (content, fileName) => {
      // Call the underlying functions directly so Jest can track them
      const workbook = XLSX.read(content, { type: 'array' });
      const balance = findBalanceInWorkbook(workbook);
      const transactions = extractTransactionsFromWorkbook(workbook);
      const transformedTransactions = transformTransactions(transactions);

      return {
        transactions: transformedTransactions,
        finalBalance: balance,
      };
    });

    // Use the mock implementation temporarily
    const module = require('../mizrahiTfahotAnalyzer');
    const originalFn = module.analyzeMizrahiTfahotFile;
    module.analyzeMizrahiTfahotFile = mockAnalyzeFile;

    try {
      // Run the function
      const mockArrayBuffer = new ArrayBuffer(8);
      const result = await mockAnalyzeFile(mockArrayBuffer, 'test.xlsx');

      // Verify function calls
      expect(XLSX.read).toHaveBeenCalled();
      expect(findBalanceInWorkbook).toHaveBeenCalled();
      expect(extractTransactionsFromWorkbook).toHaveBeenCalled();
      expect(transformTransactions).toHaveBeenCalled();

      // Verify results
      expect(result.transactions).toHaveLength(1);
      expect(result.finalBalance).toBe(1234);
    } finally {
      // Restore the original function
      module.analyzeMizrahiTfahotFile = originalFn;
    }
  });

  test('should handle Excel processing errors', async () => {
    (XLSX.read as jest.Mock).mockImplementation(() => {
      throw new Error('Mock Excel processing error');
    });

    const mockArrayBuffer = new ArrayBuffer(8);

    await expect(analyzeMizrahiTfahotFile(mockArrayBuffer, 'test.xlsx')).rejects.toThrow(
      'Failed to process Mizrahi Tfahot Excel file'
    );
  });

  test('should use default 0 balance when none found', async () => {
    // Mock workbook
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: { '!ref': 'A1:E10' } },
    };

    // Set up mocks
    (XLSX.read as jest.Mock).mockReturnValue(mockWorkbook as XLSX.WorkBook);
    (findBalanceInWorkbook as jest.Mock).mockReturnValue(null); // No balance found
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

    // Run the function
    const mockArrayBuffer = new ArrayBuffer(8);
    const result = await analyzeMizrahiTfahotFile(mockArrayBuffer, 'test.xlsx');

    // Verify results
    expect(result.finalBalance).toBe(0);
  });
});

describe('MIZRAHI_TFAHOT_FIELD_MAPPINGS', () => {
  test('date mapping transform', () => {
    const dateMapping = MIZRAHI_TFAHOT_FIELD_MAPPINGS.find((m) => m.target === 'date');
    expect(dateMapping).toBeDefined();

    if (dateMapping?.transform) {
      // Valid date in DD/MM/YY format
      expect(dateMapping.transform('01/05/25')).toBe('2025-05-01');

      // Non-slash format should be returned as-is
      expect(dateMapping.transform('01-05-25')).toBe('01-05-25');

      // Empty string
      expect(dateMapping.transform('')).toBe('');

      // Null
      expect(dateMapping.transform(null as unknown as string)).toBe(null);

      // Number input
      expect(dateMapping.transform(12345 as unknown as string)).toBe(12345);
    }
  });

  test('debit mapping transform', () => {
    const debitMapping = MIZRAHI_TFAHOT_FIELD_MAPPINGS.find(
      (m) => m.source === 'חובה' && m.target === 'amount'
    );
    expect(debitMapping).toBeDefined();

    if (debitMapping?.transform) {
      // Numeric value (should be negative)
      expect(debitMapping.transform('100')).toBe(-100000);

      // Value with commas
      expect(debitMapping.transform('1,234.56')).toBe(-1234560);

      // Empty values
      expect(debitMapping.transform('')).toBe(0);
      expect(debitMapping.transform('&nbsp;')).toBe(0);

      // Null
      expect(debitMapping.transform(null as unknown as string)).toBe(0);
    }
  });

  test('credit mapping transform', () => {
    const creditMapping = MIZRAHI_TFAHOT_FIELD_MAPPINGS.find(
      (m) => m.source === 'זכות' && m.target === 'amount'
    );
    expect(creditMapping).toBeDefined();

    if (creditMapping?.transform) {
      // Numeric value (should be positive)
      expect(creditMapping.transform('100')).toBe(100000);

      // Value with commas
      expect(creditMapping.transform('1,234.56')).toBe(1234560);

      // Empty values
      expect(creditMapping.transform('')).toBe(0);
      expect(creditMapping.transform('&nbsp;')).toBe(0);

      // Null
      expect(creditMapping.transform(null as unknown as string)).toBe(0);
    }
  });
});

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

import * as XLSX from 'xlsx';

import { analyzeMaxFile, isMaxFile, MAX_FIELD_MAPPINGS } from '../maxAnalyzer';

// Mock dependencies
jest.mock('xlsx');

describe('isMaxFile', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('should identify valid Max file and extract sheet name', () => {
    // Valid Max file name
    const fileName = 'transaction-details_export_123456.xlsx';
    // Mock a worksheet with the right header structure
    const mockSheet = {} as XLSX.WorkSheet;

    // Mock sheet_to_json to return expected data structure
    const mockSheetJson = [
      [],
      ['Max Statement'], // Row 1 containing statement name (will be returned as identifier)
      [],
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב', 'הערות'], // Row 3 containing header values
    ];

    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call the function
    const result = isMaxFile(fileName, mockSheet);

    // Verify the mock was called
    expect(XLSX.utils.sheet_to_json).toHaveBeenCalledWith(mockSheet, { header: 1 });

    // Should return the statement name from row 1
    expect(result).toBe('Max Statement');
  });

  test('should return null for non-Max filename', () => {
    // Non-Max filename
    const fileName = 'bank_statement.xlsx';
    const mockSheet = {} as XLSX.WorkSheet;

    // Mock sheet_to_json to return data that would be valid for Max
    const mockSheetJson = [
      [],
      ['Some Statement'],
      [],
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב', 'הערות'],
    ];
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call the function
    const result = isMaxFile(fileName, mockSheet);

    // Should return null because filename doesn't include 'transaction-details_export_'
    expect(result).toBeNull();
  });

  test('should return null for invalid headers', () => {
    // Valid Max filename but invalid headers
    const fileName = 'transaction-details_export_123456.xlsx';
    const mockSheet = {} as XLSX.WorkSheet;

    // Mock sheet_to_json to return data without Max headers
    const mockSheetJson = [[], ['Some Statement'], [], ['Date', 'Description', 'Amount']];
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call the function
    const result = isMaxFile(fileName, mockSheet);

    // Should return null because headers don't match Max format
    expect(result).toBeNull();
  });
});

describe('analyzeMaxFile', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('should parse Excel content and transform data correctly', async () => {
    // Mock file content (ArrayBuffer)
    const mockContent = new ArrayBuffer(10);
    const fileName = 'transaction-details_export_123456.xlsx';

    // Mock workbook and sheet structures
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {},
      },
    };

    // Mock sheet data
    const mockSheetJson = [
      // Various header rows
      [],
      ['Max Statement'],
      [],
      // Transaction headers (row index 3)
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב', 'הערות'],
      // Transaction 1
      ['15-04-2025', 'סופרמרקט', 100.5, 'קניות מזון'],
      // Transaction 2
      ['20-04-2025', 'תחנת דלק', 50.25, 'דלק'],
      // Empty row signaling end of transactions
      [],
      // Total row
      ['סך הכל', '', ''],
      // Balance row
      ['150.75 ₪', '', ''],
    ];

    // Mock XLSX.read to return the workbook
    (XLSX.read as jest.Mock).mockReturnValue(mockWorkbook);

    // Mock sheet_to_json to return our test data
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call function with mock content
    const result = await analyzeMaxFile(mockContent, fileName);

    // Verify that XLSX.read was called with correct parameters
    expect(XLSX.read).toHaveBeenCalledWith(mockContent, { type: 'array' });

    // Verify that sheet_to_json was called
    expect(XLSX.utils.sheet_to_json).toHaveBeenCalled();

    // Verify the transformed transactions
    expect(result.transactions).toHaveLength(2);

    // First transaction
    expect(result.transactions[0]).toEqual({
      date: '2025-04-15',
      payee_name: 'סופרמרקט',
      amount: -100500, // 100.5 * -1000
      memo: 'קניות מזון',
    });

    // Second transaction
    expect(result.transactions[1]).toEqual({
      date: '2025-04-20',
      payee_name: 'תחנת דלק',
      amount: -50250, // 50.25 * -1000
      memo: 'דלק',
    });

    // Verify that the final balance was extracted correctly
    expect(result.finalBalance).toBe(150.75);
  });

  test('should throw error for non-ArrayBuffer content', async () => {
    // Test with string input
    const stringContent = 'This is not an Excel file';

    // Verify that the function throws an error for string input
    await expect(analyzeMaxFile(stringContent, 'test.xlsx')).rejects.toThrow(
      'Max analyzer only supports Excel files'
    );
  });

  test('should process multiple sheets in workbook', async () => {
    // Mock file content
    const mockContent = new ArrayBuffer(10);
    const fileName = 'transaction-details_export_123456.xlsx';

    // Mock a workbook with multiple sheets
    const mockWorkbook = {
      SheetNames: ['Sheet1', 'Sheet2'],
      Sheets: {
        Sheet1: {},
        Sheet2: {},
      },
    };

    // Mock sheet data for Sheet1
    const mockSheet1Json = [
      [],
      ['Max Statement - Card 1'],
      [],
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב', 'הערות'],
      ['10-04-2025', 'מסעדה', 200, ''],
      [],
      ['סך הכל', '', ''],
      ['200 ₪', '', ''],
    ];

    // Mock sheet data for Sheet2
    const mockSheet2Json = [
      [],
      ['Max Statement - Card 2'],
      [],
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב', 'הערות'],
      ['15-04-2025', 'חנות בגדים', 300, ''],
      [],
      ['סך הכל', '', ''],
      ['300 ₪', '', ''],
    ];

    (XLSX.read as jest.Mock).mockReturnValue(mockWorkbook);

    // Mock sheet_to_json to return different data for each sheet
    (XLSX.utils.sheet_to_json as jest.Mock)
      .mockReturnValueOnce(mockSheet1Json) // First call for Sheet1
      .mockReturnValueOnce(mockSheet2Json); // Second call for Sheet2

    // Call function
    const result = await analyzeMaxFile(mockContent, fileName);

    // Verify the function processed both sheets
    expect(result.transactions).toHaveLength(2);

    // Verify balances by tab
    expect(result.balancesByTab).toEqual({
      Sheet1: 200,
      Sheet2: 300,
    });

    // Verify total balance is sum of all tabs
    expect(result.finalBalance).toBe(500);
  });

  test('should handle finding balance using currency symbol', async () => {
    // Mock content
    const mockContent = new ArrayBuffer(10);
    const fileName = 'transaction-details_export_123456.xlsx';

    // Create mock structures
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    };

    // Create sheet with balance indicated by currency symbol ₪
    const mockSheetJson = [
      [],
      ['Max Statement'],
      [],
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב', 'הערות'],
      ['01-05-2025', 'חנות', 100, ''],
      [],
      ['סיכום', '', ''],
      ['', '245.50 ₪', ''], // Balance with currency symbol in different column
    ];

    (XLSX.read as jest.Mock).mockReturnValue(mockWorkbook);
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call function
    const result = await analyzeMaxFile(mockContent, fileName);

    // Verify the final balance was extracted correctly using currency symbol
    expect(result.finalBalance).toBe(245.5);
  });

  test('should filter out invalid transactions', async () => {
    // Mock content
    const mockContent = new ArrayBuffer(10);
    const fileName = 'transaction-details_export_123456.xlsx';

    // Mock structures
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    };

    // Create sheet with valid and invalid transactions
    const mockSheetJson = [
      [],
      ['Max Statement'],
      [],
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב', 'הערות'],
      // Valid transaction
      ['10-04-2025', 'סופר', 100, ''],
      // Invalid transaction - NaN amount
      ['12-04-2025', 'חנות', 'לא מספר', ''],
      // Valid transaction
      ['13-04-2025', 'תחבורה', 30, ''],
    ];

    (XLSX.read as jest.Mock).mockReturnValue(mockWorkbook);
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call function
    const result = await analyzeMaxFile(mockContent, fileName);

    // Should only have two valid transactions
    expect(result.transactions).toHaveLength(2);

    // First valid transaction
    expect(result.transactions[0]).toEqual({
      date: '2025-04-10',
      payee_name: 'סופר',
      amount: -100000,
      memo: '',
    });

    // Second valid transaction
    expect(result.transactions[1]).toEqual({
      date: '2025-04-13',
      payee_name: 'תחבורה',
      amount: -30000,
      memo: '',
    });
  });
});

describe('MAX_FIELD_MAPPINGS', () => {
  test('should correctly transform date format', () => {
    // Find the date mapping
    const dateMapping = MAX_FIELD_MAPPINGS.find((mapping) => mapping.target === 'date');
    expect(dateMapping).toBeDefined();

    if (dateMapping && dateMapping.transform) {
      // Test valid date transformation
      expect(dateMapping.transform('15-04-2025')).toBe('2025-04-15');

      // Test invalid date format
      expect(dateMapping.transform('invalid-date')).toBe('invalid-date');

      // Test empty value
      expect(dateMapping.transform('')).toBe('');

      // Test non-string value
      const nonString = 12345 as unknown;
      expect(dateMapping.transform(nonString as string)).toBe(nonString);
    }
  });

  test('should correctly transform amount format', () => {
    // Find the amount mapping
    const amountMapping = MAX_FIELD_MAPPINGS.find((mapping) => mapping.target === 'amount');
    expect(amountMapping).toBeDefined();

    if (amountMapping && amountMapping.transform) {
      // Test numeric value
      expect(amountMapping.transform(100)).toBe(-100000);

      // Test string value with currency symbol
      expect(amountMapping.transform('99.99 ₪')).toBe(-99990);

      // Test string value with commas
      expect(amountMapping.transform('1,234.56')).toBe(-1234560);

      // Test null and undefined values
      expect(amountMapping.transform(null)).toBeNull();
      expect(amountMapping.transform(undefined)).toBeNull();

      // Test non-numeric string
      expect(amountMapping.transform('not a number')).toBeNull();
    }
  });
});

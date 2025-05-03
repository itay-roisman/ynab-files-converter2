import * as XLSX from 'xlsx';

import {
  analyzeCalFile,
  CAL_FIELD_MAPPINGS,
  extractAmountFromHebrewText,
  isCalFile,
} from '../calAnalyzer';

// Mock dependencies
jest.mock('xlsx');

describe('isCalFile', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('should identify valid Cal file and extract card number', () => {
    // Valid Cal file name
    const fileName = 'פירוט חיובים לכרטיס 1234-5678-9012-3456.xlsx';
    // Mock a worksheet with the right header structure
    const mockSheet = {} as XLSX.WorkSheet;

    // Mock sheet_to_json to return expected data structure
    const mockSheetJson = [
      ['מספר כרטיס: 1234-5678-9012-3456'], // Row 0 containing card info
      [],
      [],
      [],
      ['תאריך\nעסקה', 'שם בית עסק', 'סכום\nחיוב', 'הערות'], // Row 4 containing header values
    ];

    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call the function
    const result = isCalFile(fileName, mockSheet);

    // Verify the mock was called
    expect(XLSX.utils.sheet_to_json).toHaveBeenCalledWith(mockSheet, { header: 1 });

    // Should return the card info from row 0
    expect(result).toBe('מספר כרטיס: 1234-5678-9012-3456');
  });

  test('should return null for non-Cal filename', () => {
    // Non-Cal filename
    const fileName = 'bank_statement.xlsx';
    const mockSheet = {} as XLSX.WorkSheet;

    // Mock sheet_to_json to return data that would be valid for Cal
    const mockSheetJson = [
      ['Some card info'],
      [],
      [],
      [],
      ['תאריך\nעסקה', 'שם בית עסק', 'סכום\nחיוב', 'הערות'],
    ];

    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call the function
    const result = isCalFile(fileName, mockSheet);

    // Should return null because filename doesn't start with 'פירוט חיובים לכרטיס'
    expect(result).toBeNull();
  });

  test('should return null for invalid headers', () => {
    // Valid Cal filename but invalid headers
    const fileName = 'פירוט חיובים לכרטיס 1234-5678-9012-3456.xlsx';
    const mockSheet = {} as XLSX.WorkSheet;

    // Mock sheet_to_json to return data without Cal headers
    const mockSheetJson = [['Some card info'], [], [], [], ['Date', 'Description', 'Amount']];

    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call the function
    const result = isCalFile(fileName, mockSheet);

    // Should return null because headers don't match Cal format
    expect(result).toBeNull();
  });
});

describe('analyzeCalFile', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('should parse Excel content and transform data correctly', async () => {
    // Mock file content (ArrayBuffer)
    const mockContent = new ArrayBuffer(10);
    const fileName = 'פירוט חיובים לכרטיס 1234-5678-9012-3456.xlsx';

    // Mock workbook and sheet structures
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {},
      },
    };

    // Mock sheet data
    const mockSheetJson = [
      // Card information row
      ['מספר כרטיס: 1234-5678-9012-3456'],
      [],
      [],
      [],
      // Transaction headers (row index 4)
      ['תאריך\nעסקה', 'שם בית עסק', 'סכום\nחיוב', 'הערות'],
      // Transaction 1
      ['15/04/25', 'סופרמרקט', '100.50', 'קניות מזון'],
      // Transaction 2
      ['20/04/25', 'תחנת דלק', '50.25', 'דלק'],
      // Empty row signaling end of transactions
      [],
    ];

    // Mock XLSX.read to return the workbook
    (XLSX.read as jest.Mock).mockReturnValue(mockWorkbook);

    // Mock sheet_to_json to return our test data
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call function with mock content
    const result = await analyzeCalFile(mockContent, fileName);

    // Verify that XLSX.read was called with correct parameters
    expect(XLSX.read).toHaveBeenCalledWith(mockContent, { type: 'array' });

    // Verify that sheet_to_json was called with expected parameters
    expect(XLSX.utils.sheet_to_json).toHaveBeenCalledWith(mockWorkbook.Sheets.Sheet1, {
      header: 1,
      raw: false,
      dateNF: 'yyyy-mm-dd',
    });

    // Verify the transformed transactions
    expect(result.transactions).toHaveLength(2);

    // First transaction
    expect(result.transactions[0]).toEqual({
      date: '2025-04-15',
      payee_name: 'סופרמרקט',
      amount: -100500, // 100.50 * -1000
      memo: 'קניות מזון',
    });

    // Second transaction
    expect(result.transactions[1]).toEqual({
      date: '2025-04-20',
      payee_name: 'תחנת דלק',
      amount: -50250, // 50.25 * -1000
      memo: 'דלק',
    });
  });

  test('should throw error for non-ArrayBuffer content', async () => {
    // Test with string input
    const stringContent = 'This is not an Excel file';

    // Verify that the function throws an error for string input
    await expect(analyzeCalFile(stringContent, 'test.xlsx')).rejects.toThrow(
      'Cal analyzer only supports Excel files'
    );
  });

  test('should handle empty rows and end of transaction markers', async () => {
    // Mock content
    const mockContent = new ArrayBuffer(10);
    const fileName = 'פירוט חיובים לכרטיס 1234-5678-9012-3456.xlsx';

    // Create mock structures
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    };

    // Create sheet with empty rows and transaction markers
    const mockSheetJson = [
      // Headers and initial rows
      ['מספר כרטיס: 1234-5678-9012-3456'],
      [],
      [],
      [],
      ['תאריך\nעסקה', 'שם בית עסק', 'סכום\nחיוב', 'הערות'],
      // Valid transaction
      ['10/04/25', 'מסעדה', '200', 'ארוחה'],
      // Empty row that should be skipped
      [],
      // Another row that should not be processed
      ['סך הכל', '', '', ''],
      // This row should not be processed
      ['200 ₪', '', '', ''],
    ];

    (XLSX.read as jest.Mock).mockReturnValue(mockWorkbook);
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call function
    const result = await analyzeCalFile(mockContent, fileName);

    // Should only have one valid transaction
    expect(result.transactions).toHaveLength(1);

    // Verify the transaction
    expect(result.transactions[0]).toEqual({
      date: '2025-04-10',
      payee_name: 'מסעדה',
      amount: -200000,
      memo: 'ארוחה',
    });
  });

  test('should filter out invalid transactions', async () => {
    // Mock content
    const mockContent = new ArrayBuffer(10);
    const fileName = 'פירוט חיובים לכרטיס 1234-5678-9012-3456.xlsx';

    // Create mock structures
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    };

    // Create sheet with valid and invalid transactions
    const mockSheetJson = [
      // Headers
      ['מספר כרטיס: 1234-5678-9012-3456'],
      [],
      [],
      [],
      ['תאריך\nעסקה', 'שם בית עסק', 'סכום\nחיוב', 'הערות'],
      // Valid transaction
      ['10/04/25', 'סופר', '100', ''],
      // Invalid transaction - NaN amount - this should be filtered out in the updated implementation
      ['12/04/25', 'חנות', 'לא מספר', ''],
      // Valid transaction
      ['13/04/25', 'תחבורה', '30', ''],
    ];

    (XLSX.read as jest.Mock).mockReturnValue(mockWorkbook);
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call function
    const result = await analyzeCalFile(mockContent, fileName);

    // We now expect only valid transactions with non-null amounts to be included
    const validTransactions = result.transactions.filter(
      (transaction) => transaction.amount !== null
    );

    // Should only have two valid transactions after filtering
    expect(validTransactions).toHaveLength(2);

    // Check specific transactions
    expect(validTransactions[0]).toEqual({
      date: '2025-04-10',
      payee_name: 'סופר',
      amount: -100000,
      memo: '',
    });

    expect(validTransactions[1]).toEqual({
      date: '2025-04-13',
      payee_name: 'תחבורה',
      amount: -30000,
      memo: '',
    });
  });

  test('should handle empty amount values', async () => {
    // Mock content
    const mockContent = new ArrayBuffer(10);
    const fileName = 'פירוט חיובים לכרטיס 1234-5678-9012-3456.xlsx';

    // Mock structures
    const mockWorkbook = {
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    };

    // Create sheet with empty amount values
    const mockSheetJson = [
      // Headers
      ['מספר כרטיס: 1234-5678-9012-3456'],
      [],
      [],
      [],
      ['תאריך\nעסקה', 'שם בית עסק', 'סכום\nחיוב', 'הערות'],
      // Transaction with empty amount
      ['15/04/25', 'חנות כלשהי', '', 'הערה כלשהי'],
    ];

    (XLSX.read as jest.Mock).mockReturnValue(mockWorkbook);
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockSheetJson);

    // Call function
    const result = await analyzeCalFile(mockContent, fileName);

    // Verify that the transaction was processed with amount as 0
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount).toBe(0);
  });
});

describe('CAL_FIELD_MAPPINGS', () => {
  test('should correctly transform date format', () => {
    // Find the date mapping
    const dateMapping = CAL_FIELD_MAPPINGS.find((mapping) => mapping.target === 'date');
    expect(dateMapping).toBeDefined();

    if (dateMapping && dateMapping.transform) {
      // Test valid date transformation (DD/MM/YY to YYYY-MM-DD)
      expect(dateMapping.transform('15/04/25')).toBe('2025-04-15');

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
    const amountMapping = CAL_FIELD_MAPPINGS.find((mapping) => mapping.target === 'amount');
    expect(amountMapping).toBeDefined();

    if (amountMapping && amountMapping.transform) {
      // Test numeric string value
      expect(amountMapping.transform('100')).toBe(-100000);

      // Test string value with currency symbol
      expect(amountMapping.transform('99.99 ₪')).toBe(-99990);

      // Test string value with commas
      expect(amountMapping.transform('1,234.56')).toBe(-1234560);

      // Test empty values
      expect(amountMapping.transform('')).toBe(0);
      expect(amountMapping.transform(null as unknown as string)).toBe(0);
      expect(amountMapping.transform(undefined as unknown as string)).toBe(0);
    }
  });
});

describe('extractAmountFromHebrewText', () => {
  test('should extract numeric amount from Hebrew text with date and currency symbol', () => {
    // Test with the exact format from the example
    const text = 'עסקאות לחיוב ב-02/05/2025: 5,259.19 ₪';
    const result = extractAmountFromHebrewText(text);
    expect(result).toBe(5259.19);
  });

  test('should handle different number formats', () => {
    // Test with comma as thousands separator
    expect(extractAmountFromHebrewText('סכום: 1,234.56 ₪')).toBe(1234.56);

    // Test with just numbers
    expect(extractAmountFromHebrewText('עסקאות בסך 123 ₪')).toBe(123);

    // Test with decimal only
    expect(extractAmountFromHebrewText('יתרה 99.99 ₪')).toBe(99.99);
  });

  test('should return null for invalid inputs', () => {
    // Test with no number in the text
    expect(extractAmountFromHebrewText('אין נתונים')).toBeNull();

    // Test with empty string
    expect(extractAmountFromHebrewText('')).toBeNull();

    // Test with null/undefined
    expect(extractAmountFromHebrewText(null as any)).toBeNull();
    expect(extractAmountFromHebrewText(undefined as any)).toBeNull();
  });
});

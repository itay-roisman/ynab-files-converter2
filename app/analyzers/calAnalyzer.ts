import * as XLSX from 'xlsx';

import { FieldMapping, VendorInfo } from './fileAnalyzer';

export const CAL_FIELD_MAPPINGS: FieldMapping[] = [
  {
    source: 'תאריך\nעסקה',
    target: 'date',
    transform: (value: string) => {
      console.log('Original date value:', value, 'type:', typeof value);
      if (!value || typeof value !== 'string' || !value.includes('/')) {
        console.log('Invalid date value:', value);
        return value;
      }
      const [day, month, year] = value.split('/');
      console.log('Date components:', { day, month, year });
      // Ensure we have all components and they are valid
      if (!day || !month || !year) {
        console.log('Missing date components:', { day, month, year });
        return value;
      }
      // Create date string in YYYY-MM-DD format
      const formattedDate = `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      console.log('Formatted date:', formattedDate);
      return formattedDate;
    },
  },
  { source: 'שם בית עסק', target: 'payee_name' },
  {
    source: 'סכום\nחיוב',
    target: 'amount',
    transform: (value: string) => {
      if (value === undefined || value === null || value === '') {
        return 0; // Return 0 for empty values
      }

      // Ensure we're working with a string
      const stringValue = String(value);

      // Skip special value 'לא מספר' (not a number)
      if (stringValue === 'לא מספר') {
        return null;
      }

      // Remove ₪ symbol, commas, and any whitespace
      const cleanValue = stringValue.replace(/[₪\s,]/g, '');
      const num = parseFloat(cleanValue);

      if (isNaN(num)) {
        return null;
      }

      return Math.floor(num * -1000); // Convert to millidollars and make negative
    },
  },
  { source: 'הערות', target: 'memo' },
];

export function isCalFile(fileName: string, sheet: XLSX.WorkSheet): string | null {
  if (!fileName.startsWith('פירוט חיובים לכרטיס')) return null;

  const sheetJson = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  const firstRow = sheetJson[4]; // Cal files have headers in row 5
  const isCal = firstRow.some(
    (cell) =>
      cell &&
      typeof cell === 'string' &&
      (cell.includes('תאריך\nעסקה') || cell.includes('שם בית עסק'))
  );

  return isCal ? sheetJson[0][0] : null; // Return the card number from the first row
}

export async function analyzeCalFile(
  content: string | ArrayBuffer,
  fileName: string
): Promise<any> {
  console.log('Starting Cal file analysis for:', fileName);

  if (typeof content === 'string') throw new Error('Cal analyzer only supports Excel files');

  const workbook = XLSX.read(content, { type: 'array' });
  console.log('Workbook sheets:', workbook.SheetNames);

  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const sheetJson = XLSX.utils.sheet_to_json<string[]>(firstSheet, {
    header: 1,
    raw: false, // This ensures all values are read as strings
    dateNF: 'yyyy-mm-dd', // This helps with date formatting
  });
  console.log('Sheet rows count:', sheetJson.length);

  // Extract final balance from row 3 (index 2) where it contains "עסקאות לחיוב"
  let finalBalance = null;
  if (sheetJson.length > 2 && Array.isArray(sheetJson[2])) {
    const balanceRow = sheetJson[2];
    const balanceCell = balanceRow[0]; // First cell of row 3

    if (balanceCell && typeof balanceCell === 'string' && balanceCell.includes('עסקאות לחיוב')) {
      // Use our new helper function to extract the amount
      finalBalance = extractAmountFromHebrewText(balanceCell);
      if (finalBalance !== null) {
        console.log('Extracted final balance from row 3:', finalBalance);
      }
    }
  }

  const headersIndex = sheetJson.findIndex(
    (row) => Array.isArray(row) && row[0] === 'תאריך\nעסקה' && row[1] === 'שם בית עסק'
  );
  console.log('Headers found at row:', headersIndex);

  if (headersIndex === -1) {
    console.log('No transaction headers found in sheet');
    return { transactions: [], finalBalance };
  }

  const transactions = [];
  const headers = sheetJson[headersIndex];

  for (let i = headersIndex + 1; i < sheetJson.length; i++) {
    const row = sheetJson[i];
    if (!row || row.length === 0 || !row[0]) {
      console.log('End of transactions at row:', i);
      break;
    }

    const transaction: any = {};
    headers.forEach((header, index) => {
      if (header && row[index]) transaction[header] = row[index];
    });
    console.log('Raw transaction:', transaction);
    transactions.push(transaction);
  }

  console.log('Raw transactions found:', transactions.length);

  const transformedTransactions = transactions.map((row) => {
    const transformedRow: any = {
      // Initialize with default values for required fields
      date: '',
      payee_name: '',
      amount: 0,
      memo: '', // Always initialize memo field
    };

    CAL_FIELD_MAPPINGS.forEach((mapping) => {
      const value = row[mapping.source];
      if (value !== undefined) {
        transformedRow[mapping.target] = mapping.transform
          ? mapping.transform(value as string)
          : value;
      }
    });

    // Special case for missing memo - ensure it's an empty string
    if (!transformedRow.memo) {
      transformedRow.memo = '';
    }

    // Don't filter out transactions with null amounts, as they may be handled by the consumer
    console.log('Transformed row:', transformedRow);
    return transformedRow;
  });

  console.log('Total transformed transactions:', transformedTransactions.length);

  // Return an object with transactions and finalBalance properties
  return {
    transactions: transformedTransactions,
    finalBalance, // This will now contain the extracted balance
  };
}

export function getCalVendorInfo(): VendorInfo {
  return {
    name: 'Cal',
    confidence: 1.0,
    uniqueIdentifiers: ['Cal Statement'],
    fieldMappings: CAL_FIELD_MAPPINGS,
    analyzeFile: analyzeCalFile,
    isVendorFile: isCalFile,
  };
}

/**
 * Extracts a numeric value from a string containing Israeli currency format.
 * Works with formats like "עסקאות לחיוב ב-02/05/2025: 5,259.19 ₪"
 *
 * @param text The string containing the amount
 * @returns The extracted number as a float, or null if no valid number found
 */
export function extractAmountFromHebrewText(text: string): number | null {
  if (!text) return null;

  // Improved regex pattern that prioritizes longer numbers with commas and decimals
  // This will match the full amount (5,259.19) instead of just the first digit (2)
  const regex = /(\d{1,3}(,\d{3})*(\.\d{1,2})?|\d+\.\d{1,2}|\d+,\d{1,2})/g;

  // Find all matches to get the longest/largest number in the string
  const matches = text.match(regex);

  if (!matches || matches.length === 0) {
    console.log(`No numeric amount found in: ${text}`);
    return null;
  }

  // Find the longest match, which is likely to be the full amount
  let longestMatch = '';
  for (const match of matches) {
    if (match.length > longestMatch.length) {
      longestMatch = match;
    }
  }

  // Get the matched value and remove any commas before parsing
  const amountStr = longestMatch.replace(/,/g, '');
  const amount = parseFloat(amountStr);

  if (isNaN(amount)) {
    console.log(`Failed to parse amount from: ${longestMatch}`);
    return null;
  }

  console.log(`Successfully extracted amount ${amount} from: ${text}`);
  return amount;
}

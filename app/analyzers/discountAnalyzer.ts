import * as XLSX from 'xlsx';

import { AnalysisResult, FieldMapping, RowData, VendorInfo } from './fileAnalyzer';

export const DISCOUNT_FIELD_MAPPINGS: FieldMapping[] = [
  {
    source: 'תאריך',
    target: 'date',
    transform: (value: string) => {
      // If it's a numeric value (Excel serial date)
      if (!isNaN(Number(value))) {
        // Convert Excel serial date to JavaScript Date
        const excelEpoch = new Date(1900, 0, -1);
        const date = new Date(excelEpoch.getTime() + Number(value) * 24 * 60 * 60 * 1000);

        // Format as YYYY-MM-DD
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        return `${year}-${month}-${day}`;
      }

      // If it's a string in format M/D/YY or MM/DD/YY
      if (typeof value === 'string' && value.includes('/')) {
        const parts = value.trim().split('/');
        if (parts.length === 3) {
          const month = parts[0].padStart(2, '0');
          const day = parts[1].padStart(2, '0');
          let year = parts[2];

          // Add 2000 to 2-digit years
          if (year.length === 2) {
            year = `20${year}`;
          }

          return `${year}-${month}-${day}`;
        }
      }

      return value;
    },
  },
  {
    source: 'תיאור התנועה',
    target: 'payee_name',
  },
  {
    source: '₪ זכות/חובה ',
    target: 'amount',
    transform: (value: string) => {
      debugger;
      if (!value || value.trim() === '') {
        return 0;
      }

      // Remove commas and convert to number
      const numericValue = Number(value.toString().replace(/,/g, ''));

      // Convert to milliunits (multiply by 1000)
      // Credit amounts are positive, debit amounts are negative
      return Number((numericValue * 1000).toFixed(0));
    },
  },
  {
    source: 'אסמכתה',
    target: 'memo',
  },
];

export function isDiscountFile(fileName: string, sheet: XLSX.WorkSheet): string | null {
  if (fileName.startsWith('עובר ושב_') && sheet && sheet['A1'] && sheet['A1'].v === 'עובר ושב') {
    // Get the account identifier from cell B2 if available
    const accountInfo = sheet['A2']?.v || 'Discount Account';
    return accountInfo.toString();
  }
  return null;
}

export function extractBalanceFromSheet(sheet: XLSX.WorkSheet): number | null {
  // According to requirements, final balance is in cell E9
  if (sheet && sheet['E9'] && sheet['E9'].v !== undefined) {
    const balanceValue = sheet['E9'].v;
    if (typeof balanceValue === 'number') {
      return balanceValue;
    } else if (typeof balanceValue === 'string') {
      // Remove commas and any non-numeric characters except decimal point
      const numericString = balanceValue.replace(/[^\d.-]/g, '');
      const numericValue = Number(numericString);
      if (!isNaN(numericValue)) {
        return numericValue;
      }
    }
  }
  return null;
}

export function extractTransactionsFromSheet(
  sheet: XLSX.WorkSheet
): Record<string, string | number>[] {
  const transactions: Record<string, string | number>[] = [];

  try {
    if (sheet && sheet['!ref']) {
      const range = XLSX.utils.decode_range(sheet['!ref']);

      // Headers are in row 8 (index 7)
      const headerRow = 7;
      const headers: string[] = [];

      // Extract headers
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: headerRow, c });
        if (sheet[cellRef] && sheet[cellRef].v) {
          headers[c] = String(sheet[cellRef].v);
        } else {
          headers[c] = '';
        }
      }

      // Extract transactions starting from row 9 (index 8)
      for (let r = headerRow + 1; r <= range.e.r; r++) {
        const transaction: Record<string, string | number> = {};
        let hasData = false;

        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          if (sheet[cellRef] && sheet[cellRef].v !== undefined && headers[c]) {
            transaction[headers[c]] = sheet[cellRef].v;
            hasData = true;
          }
        }

        // Only add rows that have data
        if (hasData && transaction['תאריך']) {
          transactions.push(transaction);
        }
      }
    }
  } catch (error) {
    console.error('Error extracting transactions:', error);
  }

  return transactions;
}

export function transformTransactions(transactions: Record<string, string | number>[]): RowData[] {
  return transactions
    .filter((row) => row !== null && typeof row === 'object')
    .map((row) => {
      // Create a new transaction object
      const transaction: RowData = {
        date: '',
        amount: 0,
        payee_name: '',
        memo: '',
      };

      // Apply field mappings
      DISCOUNT_FIELD_MAPPINGS.forEach((mapping) => {
        const value = row[mapping.source];
        if (value !== undefined) {
          // @ts-expect-error - We're handling various property assignments
          transaction[mapping.target] = mapping.transform
            ? mapping.transform(String(value))
            : value;
        }
      });

      return transaction;
    });
}

export async function analyzeDiscountFile(
  content: string | ArrayBuffer,
  _fileName: string
): Promise<AnalysisResult> {
  let transactions: Record<string, string | number>[] = [];
  let finalBalance: number | null = null;

  if (typeof content !== 'string') {
    // For Excel/CSV files
    try {
      const workbook = XLSX.read(content, {
        type: 'array',
      });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

      // Extract final balance from cell E9
      finalBalance = extractBalanceFromSheet(firstSheet);

      // Extract and transform transactions
      transactions = extractTransactionsFromSheet(firstSheet);
    } catch (error) {
      throw new Error('Failed to process Discount bank file');
    }
  } else {
    // For CSV text content
    try {
      const workbook = XLSX.read(content, { type: 'string' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

      // Extract final balance
      finalBalance = extractBalanceFromSheet(firstSheet);

      // Extract and transform transactions
      transactions = extractTransactionsFromSheet(firstSheet);
    } catch (error) {
      throw new Error('Failed to process Discount bank CSV file');
    }
  }

  // Transform transactions to the required format
  const transformedTransactions = transformTransactions(transactions);

  // Ensure finalBalance is not null
  if (finalBalance === null) {
    finalBalance = 0;
  }

  return {
    transactions: transformedTransactions,
    finalBalance,
  };
}

export function getDiscountVendorInfo(): VendorInfo {
  return {
    name: 'Discount',
    confidence: 1.0,
    uniqueIdentifiers: ['עובר ושב'],
    fieldMappings: DISCOUNT_FIELD_MAPPINGS,
    analyzeFile: analyzeDiscountFile,
    isVendorFile: isDiscountFile,
  };
}

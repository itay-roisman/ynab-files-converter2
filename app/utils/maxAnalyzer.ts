import * as XLSX from 'xlsx';
import { FieldMapping, VendorInfo, RowData } from './fileAnalyzer';

export const MAX_FIELD_MAPPINGS: FieldMapping[] = [
  {
    source: 'תאריך עסקה',
    target: 'date',
    transform: (value: string) => {
      if (!value || typeof value !== 'string' || !value.includes('-')) {
        return value;
      }
      const [day, month, year] = value.split('-');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    },
  },
  { source: 'שם בית העסק', target: 'payee_name' },
  {
    source: 'סכום חיוב',
    target: 'amount',
    transform: (value: any) => {
      if (!value) return null;

      // Handle string values
      if (typeof value === 'string') {
        // Remove any currency symbols and whitespace
        const cleanValue = value.replace(/[₪\s,]/g, '');
        const num = parseFloat(cleanValue);
        return isNaN(num) ? null : Math.floor(num * -1000); // Convert to millidollars and make negative
      }

      // Handle number values
      if (typeof value === 'number') {
        return Math.round(value * -1000); // Convert to millidollars and make negative
      }

      return null;
    },
  },
  {
    source: 'הערות',
    target: 'memo',
  },
];

export function isMaxFile(fileName: string, sheet: XLSX.WorkSheet): string | null {
  if (!fileName.toLowerCase().includes('transaction-details_export_')) return null;

  const sheetJson = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  const firstRow = sheetJson[3]; // Max files have headers in row 4
  const isMax = firstRow.some(
    (cell) =>
      cell &&
      typeof cell === 'string' &&
      (cell.includes('תאריך עסקה') || cell.includes('שם בית העסק'))
  );

  return isMax ? sheetJson[1][0] : null; // Return value from cell A4 (row 2, column 1)
}

export async function analyzeMaxFile(
  content: string | ArrayBuffer,
  fileName: string
): Promise<any> {
  console.log('Starting Max file analysis for:', fileName);

  if (typeof content === 'string') throw new Error('Max analyzer only supports Excel files');

  const workbook = XLSX.read(content, { type: 'array' });
  console.log('Workbook sheets:', workbook.SheetNames);

  const allTransactions = [];
  let totalBalance = 0;
  const balancesByTab: Record<string, number> = {};

  // Process each tab in the workbook
  for (const sheetName of workbook.SheetNames) {
    console.log(`Processing tab: ${sheetName}`);
    const sheet = workbook.Sheets[sheetName];
    const { transactions, finalBalance } = await processMaxSheet(sheet);

    if (transactions.length > 0) {
      allTransactions.push(...transactions);
    }

    if (finalBalance !== null && !isNaN(finalBalance)) {
      balancesByTab[sheetName] = finalBalance;
      totalBalance += finalBalance;
      console.log(`Final balance in tab ${sheetName}: ${finalBalance}`);
    }
  }

  console.log('Total balance from all tabs:', totalBalance);
  console.log('Balances by tab:', balancesByTab);
  console.log('Total transactions:', allTransactions.length);

  return {
    transactions: allTransactions,
    finalBalance: totalBalance,
    balancesByTab: balancesByTab,
  };
}

async function processMaxSheet(
  sheet: XLSX.WorkSheet
): Promise<{ transactions: any[]; finalBalance: number | null }> {
  const sheetJson = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  console.log('Sheet rows count:', sheetJson.length);

  const headersIndex = sheetJson.findIndex(
    (row) => Array.isArray(row) && row[0] === 'תאריך עסקה' && row[1] === 'שם בית העסק'
  );
  console.log('Headers found at row:', headersIndex);

  if (headersIndex === -1) {
    console.log('No transaction headers found in sheet');
    return { transactions: [], finalBalance: null };
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

  console.log('Raw transactions found in sheet:', transactions.length);

  // Extract final balance
  let finalBalance = null;

  // Look for the "סך הכל" (total) row followed by a row with the balance amount
  const totalRowIndex = sheetJson.findIndex((row) => Array.isArray(row) && row[0] === 'סך הכל');

  if (totalRowIndex !== -1 && totalRowIndex + 1 < sheetJson.length) {
    // The balance should be in the first cell of the next row
    const balanceRow = sheetJson[totalRowIndex + 1];
    if (balanceRow && balanceRow[0]) {
      const balanceStr = String(balanceRow[0]);
      console.log('Found balance string:', balanceStr);

      // Extract the numeric value from the string (removing ₪ symbol and any commas)
      const matches = balanceStr.match(/[\d.,]+/);
      if (matches) {
        finalBalance = parseFloat(matches[0].replace(',', '.'));
        console.log('Extracted final balance:', finalBalance);
      }
    }
  } else {
    // Alternative approach: look for a cell that contains "₪" currency symbol
    for (let i = sheetJson.length - 1; i >= 0; i--) {
      const row = sheetJson[i];
      if (!row || !Array.isArray(row)) continue;

      for (let j = 0; j < row.length; j++) {
        if (row[j] && typeof row[j] === 'string' && row[j].includes('₪')) {
          const balanceStr = String(row[j]);
          console.log('Found balance with ₪ symbol:', balanceStr, 'at row:', i);

          // Extract the numeric value
          const matches = balanceStr.match(/[\d.,]+/);
          if (matches) {
            finalBalance = parseFloat(matches[0].replace(',', '.'));
            console.log('Extracted final balance from currency symbol:', finalBalance);
            i = -1; // Break out of outer loop
            break;
          }
        }
      }
    }
  }

  const transformedTransactions = transactions
    .map((row) => {
      const transformedRow: any = {};
      MAX_FIELD_MAPPINGS.forEach((mapping) => {
        const value = row[mapping.source];
        if (value !== undefined && !transformedRow[mapping.target]) {
          transformedRow[mapping.target] = mapping.transform
            ? mapping.transform(value as string)
            : value;
        }
      });

      if (isNaN(transformedRow.amount)) {
        return null;
      }

      console.log('Transformed row:', transformedRow);
      return transformedRow;
    })
    .filter((row) => row !== null);

  console.log('Transformed transactions in sheet:', transformedTransactions.length);
  console.log('Final balance found in sheet:', finalBalance);

  return {
    transactions: transformedTransactions,
    finalBalance: finalBalance,
  };
}

export function getMaxVendorInfo(): VendorInfo {
  return {
    name: 'Max',
    confidence: 1.0,
    uniqueIdentifiers: ['Max Statement'],
    fieldMappings: MAX_FIELD_MAPPINGS,
    analyzeFile: analyzeMaxFile,
    isVendorFile: isMaxFile,
  };
}

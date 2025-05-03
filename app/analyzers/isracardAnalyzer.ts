import * as XLSX from 'xlsx';

import { FieldMapping, VendorInfo } from './fileAnalyzer';

export const ISRACARD_FIELD_MAPPINGS: FieldMapping[] = [
  {
    source: 'תאריך רכישה',
    target: 'date',
    transform: (value: string) => {
      if (!value || typeof value !== 'string' || !value.includes('/')) {
        return value;
      }
      const [day, month, year] = value.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    },
  },
  { source: 'שם בית עסק', target: 'payee_name' },
  {
    source: 'סכום חיוב',
    target: 'amount',
    transform: (value: number) => {
      return Number((value * -1000).toFixed(2));
    },
  },
  { source: 'פירוט נוסף', target: 'memo' },
];

export function isIsracardFile(fileName: string, sheet: XLSX.WorkSheet): string | null {
  if (!fileName.startsWith('Export_')) return null;

  const sheetJson = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  const firstRow = sheetJson[5];
  const isIsracard = firstRow.some(
    (cell) =>
      cell &&
      typeof cell === 'string' &&
      (cell.includes('תאריך רכישה') || cell.includes('שם בית עסק'))
  );

  return isIsracard ? sheetJson[3][0] : null;
}

export async function analyzeIsracardFile(
  content: string | ArrayBuffer,
  fileName: string
): Promise<any> {
  if (typeof content === 'string') {
    throw new Error('Isracard analyzer only supports Excel files');
  }

  const workbook = XLSX.read(content, { type: 'array' });

  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const sheetJson = XLSX.utils.sheet_to_json<string[]>(firstSheet, { header: 1 });

  // Extract final balance
  let finalBalance = null;

  // Try to find the total charge row
  for (let i = 0; i < sheetJson.length; i++) {
    const row = sheetJson[i];

    if (Array.isArray(row)) {
      const hasTotalCharge = row.some(
        (cell) => cell && typeof cell === 'string' && cell.includes('סך חיוב בש"ח')
      );

      if (hasTotalCharge) {
        // For Isracard XLS files, the balance is typically found in position 4
        const balanceIndex = 4; // Usually the 5th column (index 4)
        if (row[balanceIndex] !== undefined) {
          if (typeof row[balanceIndex] === 'number') {
            finalBalance = row[balanceIndex];
          } else if (typeof row[balanceIndex] === 'string') {
            // Try to extract number from string with currency symbol
            const matches = String(row[balanceIndex]).match(/[\d,\.]+/);
            if (matches) {
              finalBalance = Number(matches[0].replace(/,/g, ''));
            }
          }
        }

        // If we didn't find the balance in the expected position, try scanning all cells
        if (finalBalance === null) {
          for (let j = 0; j < row.length; j++) {
            if (row[j] && typeof row[j] !== 'undefined') {
              if (typeof row[j] === 'number') {
                finalBalance = row[j];
                break;
              } else if (typeof row[j] === 'string') {
                // Try to extract number from string
                const matches = String(row[j]).match(/[\d,\.]+/);
                if (matches) {
                  finalBalance = Number(matches[0].replace(/,/g, ''));
                  break;
                }
              }
            }
          }
        }

        break;
      }
    }
  }

  const domesticStartIndex = sheetJson.findIndex(
    (row) => Array.isArray(row) && row[0] === 'תאריך רכישה' && row[1] === 'שם בית עסק'
  );

  const foreignStartIndex = sheetJson.findIndex(
    (row) => Array.isArray(row) && row[0] === 'תאריך רכישה' && row[1] === 'תאריך חיוב'
  );

  const transactions = [];

  if (domesticStartIndex !== -1) {
    const headers = sheetJson[domesticStartIndex];

    for (let i = domesticStartIndex + 1; i < sheetJson.length; i++) {
      const row = sheetJson[i];
      if (!row || row.length === 0 || !row[0]) {
        break;
      }

      if (
        typeof row[0] === 'string' &&
        (row[0].includes('סך חיוב בש"ח') || row[0].includes('עסקאות בחו"ל'))
      ) {
        break;
      }

      const transaction: any = {};
      headers.forEach((header, index) => {
        if (header && row[index] !== undefined) transaction[header] = row[index];
      });

      // Skip rows that might be summary rows
      if (Object.keys(transaction).length < 3) {
        continue;
      }

      transactions.push(transaction);
    }
  }

  if (foreignStartIndex !== -1) {
    const headers = sheetJson[foreignStartIndex];

    for (let i = foreignStartIndex + 1; i < sheetJson.length; i++) {
      const row = sheetJson[i];
      // Skip empty rows
      if (!row || row.length === 0) {
        continue;
      }

      // Check if we've reached the end of the transaction section
      if (
        row[0] &&
        typeof row[0] === 'string' &&
        (row[0].includes('סך') || row[0].includes('דביט') || row[0].includes('אין נתונים'))
      ) {
        break;
      }

      // Skip TOTAL FOR DATE rows but continue processing
      if (row[1] && typeof row[1] === 'string' && row[1] === 'TOTAL FOR DATE') {
        continue;
      }

      const transaction: any = {};
      headers.forEach((header, index) => {
        if (header && row[index] !== undefined) transaction[header] = row[index];
      });

      // Skip rows that might be summary rows
      if (Object.keys(transaction).length < 3) {
        continue;
      }

      transactions.push(transaction);
    }
  }

  const transformedTransactions = transactions
    .map((row) => {
      const transformedRow: any = {};
      ISRACARD_FIELD_MAPPINGS.forEach((mapping) => {
        const value = row[mapping.source];
        if (value !== undefined && !transformedRow[mapping.target]) {
          transformedRow[mapping.target] = mapping.transform
            ? mapping.transform(value as string)
            : value;
        }
      });

      if (transformedRow.payee_name?.includes('סך חיוב בש"ח')) {
        return null;
      }

      if (isNaN(transformedRow.amount)) {
        return null;
      }

      return transformedRow;
    })
    .filter((row) => row !== null);

  return {
    transactions: transformedTransactions,
    finalBalance: finalBalance,
  };
}

export function getIsracardVendorInfo(): VendorInfo {
  return {
    name: 'Isracard',
    confidence: 1.0,
    uniqueIdentifiers: ['Isracard Statement'],
    fieldMappings: ISRACARD_FIELD_MAPPINGS,
    analyzeFile: analyzeIsracardFile,
    isVendorFile: isIsracardFile,
  };
}

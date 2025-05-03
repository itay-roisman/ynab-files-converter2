import Papa from 'papaparse';
import * as XLSX from 'xlsx';

import { FieldMapping, RowData, VendorInfo } from './fileAnalyzer';

export const POALIM_FIELD_MAPPINGS: FieldMapping[] = [
  { source: 'תאריך', target: 'date' },
  { source: 'תיאור הפעולה', target: 'payee_name' },
  { source: 'פרטים', target: 'memo' },
  {
    source: 'חובה',
    target: 'amount',
    transform: (value: string) => {
      if (!value) return null;
      const num = parseInt(value.replace('.', ''));
      return isNaN(num) ? null : num * -10;
    },
  },
  {
    source: 'זכות',
    target: 'amount',
    transform: (value: string) => {
      if (!value) return null;
      const num = parseInt(value.replace('.', ''));
      return isNaN(num) ? null : num * 10;
    },
  },
];

export function isPoalimFile(fileName: string, headers: string[]): string | null {
  console.log('Checking POALIM file:', {
    fileName,
    headers,
    isShekelFile: fileName.toLowerCase().startsWith('shekel'),
    hasPoalimHeaders:
      headers.join() ===
      'תאריך,תיאור הפעולה,פרטים,חשבון,אסמכתא,תאריך ערך,חובה,זכות,יתרה לאחר פעולה,',
  });

  const isShekelFile = fileName.toLowerCase().startsWith('shekel');
  const hasPoalimHeaders =
    headers.join() === 'תאריך,תיאור הפעולה,פרטים,חשבון,אסמכתא,תאריך ערך,חובה,זכות,יתרה לאחר פעולה,';

  if (isShekelFile && hasPoalimHeaders) {
    // Extract account number from filename (9 digits after 'shekel')
    const accountNumber = fileName.substring(6, 15);
    return accountNumber;
  }
  return null;
}

export async function analyzePoalimFile(content: string | ArrayBuffer): Promise<any> {
  if (typeof content === 'string') {
    const result = Papa.parse<RowData>(content, {
      header: true,
      skipEmptyLines: true,
    });

    if (result.errors.length > 0) {
      throw new Error('Failed to parse CSV file');
    }

    const transactions = result.data.map((row) => {
      const transformedRow: any = {};
      POALIM_FIELD_MAPPINGS.forEach((mapping) => {
        const value = row[mapping.source];
        if (value !== undefined && !transformedRow[mapping.target]) {
          transformedRow[mapping.target] = mapping.transform
            ? mapping.transform(value as string)
            : value;
        }
      });
      return transformedRow;
    });

    // Get the final balance from the last row
    const lastRow = result.data[result.data.length - 1];
    const finalBalance = lastRow['יתרה לאחר פעולה']
      ? parseFloat(String(lastRow['יתרה לאחר פעולה']).replace(',', ''))
      : null;

    return {
      transactions,
      finalBalance,
    };
  } else {
    throw new Error('POALIM analyzer only supports CSV files');
  }
}

export function getPoalimVendorInfo(): VendorInfo {
  return {
    name: 'Bank Hapoalim',
    confidence: 1.0,
    uniqueIdentifiers: ['POALIM Bank Statement'],
    fieldMappings: POALIM_FIELD_MAPPINGS,
    analyzeFile: analyzePoalimFile,
    isVendorFile: (fileName: string, sheet: XLSX.WorkSheet) => {
      const headers = Object.values(sheet);
      console.log('Checking POALIM file:', {
        fileName,
        headers,
        isShekelFile: fileName.toLowerCase().startsWith('shekel'),
        hasPoalimHeaders:
          headers.join() ===
          'תאריך,תיאור הפעולה,פרטים,חשבון,אסמכתא,תאריך ערך,חובה,זכות,יתרה לאחר פעולה,',
      });

      const isShekelFile = fileName.toLowerCase().startsWith('shekel');
      const hasPoalimHeaders =
        headers.join() ===
        'תאריך,תיאור הפעולה,פרטים,חשבון,אסמכתא,תאריך ערך,חובה,זכות,יתרה לאחר פעולה,';

      if (isShekelFile && hasPoalimHeaders) {
        // Extract account number from filename (9 digits after 'shekel')
        return fileName.substring(6, 15);
      }
      return null;
    },
  };
}

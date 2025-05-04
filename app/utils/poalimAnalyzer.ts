import Papa from 'papaparse';
import { FieldMapping, VendorInfo } from './fileAnalyzer';
import * as XLSX from 'xlsx';

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
  });

  const isShekelFile = fileName.toLowerCase().startsWith('shekel');

  // More flexible header checking - make sure all required fields are present
  const requiredHeaders = ['תאריך', 'תיאור הפעולה', 'פרטים', 'חובה', 'זכות', 'יתרה לאחר פעולה'];
  const hasRequiredHeaders = requiredHeaders.every((header) => headers.includes(header));

  if (isShekelFile && hasRequiredHeaders) {
    // Extract account number from filename (9 digits after 'shekel')
    const accountNumber = fileName.substring(6, 15);
    return accountNumber;
  }
  return null;
}

export async function analyzePoalimFile(
  content: string | ArrayBuffer,
  fileName: string
): Promise<any> {
  if (typeof content === 'string') {
    const result = Papa.parse<Record<string, any>>(content, {
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
      // Properly extract headers from Excel sheet
      const sheetData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
      // Look for header row in first few rows (some files might have metadata before headers)
      let headerRow: string[] = [];
      for (let i = 0; i < Math.min(5, sheetData.length); i++) {
        const row = sheetData[i];
        if (Array.isArray(row) && row.includes('תאריך') && row.includes('תיאור הפעולה')) {
          headerRow = row;
          break;
        }
      }

      console.log('Checking POALIM Excel file:', {
        fileName,
        headerRow,
        isShekelFile: fileName.toLowerCase().startsWith('shekel'),
      });

      const isShekelFile = fileName.toLowerCase().startsWith('shekel');

      // More flexible header checking
      const requiredHeaders = ['תאריך', 'תיאור הפעולה', 'פרטים', 'חובה', 'זכות', 'יתרה לאחר פעולה'];
      const hasRequiredHeaders = requiredHeaders.every((header) => headerRow.includes(header));

      if (isShekelFile && hasRequiredHeaders) {
        // Extract account number from filename (9 digits after 'shekel')
        return fileName.substring(6, 15);
      }
      return null;
    },
  };
}

import * as XLSX from 'xlsx';
import { FieldMapping, VendorInfo, RowData } from './fileAnalyzer';

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
    }
  },
  { source: 'שם בית עסק', target: 'payee_name' },
  { 
    source: 'סכום\nחיוב', 
    target: 'amount',
    transform: (value: string) => {
      if (!value) return null;
      
      // Ensure we're working with a string
      const stringValue = String(value);
      
      // Remove ₪ symbol and any whitespace
      const cleanValue = stringValue.replace(/[₪\s]/g, '');
      const num = parseFloat(cleanValue);
      return isNaN(num) ? null : Math.floor(num * -1000); // Convert to millidollars and make negative
    }
  },
  { source: 'הערות', target: 'memo' }
];

export function isCalFile(fileName: string, sheet: XLSX.WorkSheet): string | null {
  if (!fileName.startsWith('פירוט חיובים לכרטיס')) return null;
  
  const sheetJson = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  const firstRow = sheetJson[4]; // Cal files have headers in row 5
  const isCal = firstRow.some(cell => 
    cell && typeof cell === 'string' && 
    (cell.includes('תאריך\nעסקה') || cell.includes('שם בית עסק'))
  );
  
  return isCal ? sheetJson[0][0] : null; // Return the card number from the first row
}

export async function analyzeCalFile(content: string | ArrayBuffer, fileName: string): Promise<any> {
  console.log('Starting Cal file analysis for:', fileName);
  
  if (typeof content === 'string') throw new Error('Cal analyzer only supports Excel files');

  const workbook = XLSX.read(content, { type: 'array' });
  console.log('Workbook sheets:', workbook.SheetNames);
  
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const sheetJson = XLSX.utils.sheet_to_json<string[]>(firstSheet, { 
    header: 1,
    raw: false, // This ensures all values are read as strings
    dateNF: 'yyyy-mm-dd' // This helps with date formatting
  });
  console.log('Sheet rows count:', sheetJson.length);
  
  const headersIndex = sheetJson.findIndex(row => 
    Array.isArray(row) && row[0] === 'תאריך\nעסקה' && row[1] === 'שם בית עסק'
  );
  console.log('Headers found at row:', headersIndex);
  
  if (headersIndex === -1) {
    console.log('No transaction headers found in sheet');
    return [];
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
  
  const transformedTransactions = transactions.map(row => {
    const transformedRow: any = {};
    CAL_FIELD_MAPPINGS.forEach(mapping => {
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
  }).filter(row => row !== null);
  
  console.log('Total transformed transactions:', transformedTransactions.length);
  return transformedTransactions;
}

export function getCalVendorInfo(): VendorInfo {
  return {
    name: 'Cal',
    confidence: 1.0,
    uniqueIdentifiers: ['Cal Statement'],
    fieldMappings: CAL_FIELD_MAPPINGS,
    analyzeFile: analyzeCalFile,
    isVendorFile: isCalFile
  };
} 
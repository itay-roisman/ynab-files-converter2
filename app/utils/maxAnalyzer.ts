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
    }
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
    }
  },
  { 
    source: 'הערות', 
    target: 'memo',
  }
];

export function isMaxFile(fileName: string, sheet: XLSX.WorkSheet): boolean {
  if (!fileName.toLowerCase().includes('transaction-details_export_')) return false;
  
  const sheetJson = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  const firstRow = sheetJson[3]; // Max files have headers in row 4
  return firstRow.some(cell => 
    cell && typeof cell === 'string' && 
    (cell.includes('תאריך עסקה') || cell.includes('שם בית העסק'))
  );
}

export async function analyzeMaxFile(content: string | ArrayBuffer, fileName: string): Promise<any> {
  console.log('Starting Max file analysis for:', fileName);
  
  if (typeof content === 'string') throw new Error('Max analyzer only supports Excel files');

  const workbook = XLSX.read(content, { type: 'array' });
  console.log('Workbook sheets:', workbook.SheetNames);
  
  const allTransactions = [];
  
  // Process domestic transactions tab
  const domesticSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (domesticSheet) {
    console.log('Processing domestic transactions tab');
    const domesticTransactions = await processMaxSheet(domesticSheet);
    allTransactions.push(...domesticTransactions);
  }
  
  // Process foreign transactions tab if it exists
  const foreignSheetName = workbook.SheetNames.find(name => name.includes('חו"ל ומט"ח'));
  if (foreignSheetName) {
    console.log('Processing foreign transactions tab:', foreignSheetName);
    const foreignSheet = workbook.Sheets[foreignSheetName];
    const foreignTransactions = await processMaxSheet(foreignSheet);
    allTransactions.push(...foreignTransactions);
  }
  
  console.log('\nTransactions ready for YNAB:', allTransactions);
  
  return allTransactions;
}

async function processMaxSheet(sheet: XLSX.WorkSheet): Promise<any[]> {
  const sheetJson = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  console.log('Sheet rows count:', sheetJson.length);
  
  const headersIndex = sheetJson.findIndex(row => 
    Array.isArray(row) && row[0] === 'תאריך עסקה' && row[1] === 'שם בית העסק'
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
  
  console.log('Raw transactions found in sheet:', transactions.length);
  
  const transformedTransactions = transactions.map(row => {
    const transformedRow: any = {};
    MAX_FIELD_MAPPINGS.forEach(mapping => {
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
  
  console.log('Transformed transactions in sheet:', transformedTransactions.length);
  return transformedTransactions;
}

export function getMaxVendorInfo(): VendorInfo {
  return {
    name: 'Max',
    confidence: 1.0,
    uniqueIdentifiers: ['Max Statement'],
    fieldMappings: MAX_FIELD_MAPPINGS,
    analyzeFile: analyzeMaxFile,
    isVendorFile: isMaxFile
  };
} 
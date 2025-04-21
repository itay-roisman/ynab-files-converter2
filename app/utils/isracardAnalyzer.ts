import * as XLSX from 'xlsx';
import { FieldMapping, VendorInfo, RowData } from './fileAnalyzer';

export const ISRACARD_FIELD_MAPPINGS: FieldMapping[] = [
  { source: 'תאריך רכישה', 
    target: 'date', 
    transform: (value: string) => {
      if (!value || typeof value !== 'string' || !value.includes('/')) {
        return value;
      }
      const [day, month, year] = value.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    } 
  },
  { source: 'שם בית עסק', target: 'payee_name' },
  { 
    source: 'סכום חיוב', 
    target: 'amount',
    transform: (value: number) => {
      return Number((value * -1000).toFixed(2));
    }
  },
  { source: 'פירוט נוסף', target: 'memo' }
];

export function isIsracardFile(fileName: string, sheet: XLSX.WorkSheet): string | null {
  if (!fileName.startsWith('Export_')) return null;
  
  const sheetJson = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  const firstRow = sheetJson[5];
  const isIsracard = firstRow.some(cell => 
    cell && typeof cell === 'string' && 
    (cell.includes('תאריך רכישה') || cell.includes('שם בית עסק'))
  );
  
  return isIsracard ? sheetJson[3][0] : null;
}

export async function analyzeIsracardFile(content: string | ArrayBuffer, fileName: string): Promise<any> {
  console.log('Starting Isracard file analysis for:', fileName);
  
  if (typeof content === 'string') throw new Error('Isracard analyzer only supports Excel files');

  const workbook = XLSX.read(content, { type: 'array' });
  console.log('Workbook sheets:', workbook.SheetNames);
  
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const sheetJson = XLSX.utils.sheet_to_json<string[]>(firstSheet, { header: 1 });
  console.log('Sheet rows count:', sheetJson.length);
  
  const domesticStartIndex = sheetJson.findIndex(row => 
    Array.isArray(row) && row[0] === 'תאריך רכישה' && row[1] === 'שם בית עסק'
  );
  console.log('Domestic transactions start at row:', domesticStartIndex);
  
  const foreignStartIndex = sheetJson.findIndex(row => 
    Array.isArray(row) && row[0] === 'תאריך רכישה' && row[1] === 'תאריך חיוב'
  );
  console.log('Foreign transactions start at row:', foreignStartIndex);
  
  const transactions = [];
  
  if (domesticStartIndex !== -1) {
    const headers = sheetJson[domesticStartIndex];
    console.log('Domestic headers:', headers);
    
    for (let i = domesticStartIndex + 1; i < sheetJson.length; i++) {
      const row = sheetJson[i];
      if (!row || row.length === 0 || !row[0]) {
        console.log('End of domestic transactions at row:', i);
        break;
      }
      
      const transaction: any = {};
      headers.forEach((header, index) => {
        if (header && row[index]) transaction[header] = row[index];
      });
      console.log('Raw domestic transaction:', transaction);
      transactions.push(transaction);
    }
  }
  
  if (foreignStartIndex !== -1) {
    const headers = sheetJson[foreignStartIndex];
    console.log('Foreign headers:', headers);
    
    for (let i = foreignStartIndex + 1; i < sheetJson.length; i++) {
      const row = sheetJson[i];
      if(row[2] === "TOTAL FOR DATE") {
        console.log('Skipping row:', i);

        continue;
      }
      if (!row || row.length === 0 || !row[0]) {
        console.log('End of foreign transactions at row:', i);
        break;
      }
      
      const transaction: any = {};
      headers.forEach((header, index) => {
        if (header && row[index]) transaction[header] = row[index];
      });
      console.log('Raw foreign transaction:', transaction);
      transactions.push(transaction);
    }
  }
  
  console.log('Total raw transactions found:', transactions.length);
  
  const transformedTransactions = transactions.map(row => {
    const transformedRow: any = {};
    ISRACARD_FIELD_MAPPINGS.forEach(mapping => {
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
    
    console.log('Transformed row:', transformedRow);
    return transformedRow;
  }).filter(row => row !== null);
  
  console.log('Total transformed transactions:', transformedTransactions.length);
  return transformedTransactions;
}

export function getIsracardVendorInfo(): VendorInfo {
  return {
    name: 'Isracard',
    confidence: 1.0,
    uniqueIdentifiers: ['Isracard Statement'],
    fieldMappings: ISRACARD_FIELD_MAPPINGS,
    analyzeFile: analyzeIsracardFile,
    isVendorFile: isIsracardFile
  };
} 
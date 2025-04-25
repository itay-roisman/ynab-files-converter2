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
  
  if (typeof content === 'string') {
    throw new Error('Isracard analyzer only supports Excel files');
  }

  const workbook = XLSX.read(content, { type: 'array' });
  console.log('Workbook sheets:', workbook.SheetNames);
  
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const sheetJson = XLSX.utils.sheet_to_json<string[]>(firstSheet, { header: 1 });
  console.log('Sheet rows count:', sheetJson.length);
  
  // Extract final balance
  let finalBalance = null;
  
  // Try to find the total charge row
  for (let i = 0; i < sheetJson.length; i++) {
    const row = sheetJson[i];
    
    if (Array.isArray(row)) {
      const hasTotalCharge = row.some(cell => 
        cell && typeof cell === 'string' && cell.includes('סך חיוב בש"ח')
      );
      
      if (hasTotalCharge) {
        console.log('Found final balance row:', JSON.stringify(row));
        
        // For Isracard XLS files, the balance is typically found in position 4
        const balanceIndex = 4; // Usually the 5th column (index 4)
        if (row[balanceIndex] !== undefined) {
          if (typeof row[balanceIndex] === 'number') {
            finalBalance = row[balanceIndex];
            console.log('Found final balance from numeric cell:', finalBalance);
          } else if (typeof row[balanceIndex] === 'string') {
            // Try to extract number from string with currency symbol
            const matches = String(row[balanceIndex]).match(/[\d,\.]+/);
            if (matches) {
              finalBalance = Number(matches[0].replace(/,/g, ''));
              console.log('Found final balance by extracting from text:', finalBalance);
            }
          }
        }
        
        // If we didn't find the balance in the expected position, try scanning all cells
        if (finalBalance === null) {
          for (let j = 0; j < row.length; j++) {
            if (row[j] && typeof row[j] !== 'undefined') {
              if (typeof row[j] === 'number') {
                finalBalance = row[j];
                console.log('Found final balance in alternate position:', finalBalance, 'at index:', j);
                break;
              } else if (typeof row[j] === 'string') {
                // Try to extract number from string
                const matches = String(row[j]).match(/[\d,\.]+/);
                if (matches) {
                  finalBalance = Number(matches[0].replace(/,/g, ''));
                  console.log('Found final balance from text in alternate position:', finalBalance, 'at index:', j);
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
      
      if (typeof row[0] === 'string' && 
         (row[0].includes('סך חיוב בש"ח') || row[0].includes('עסקאות בחו"ל'))) {
        console.log('End of domestic transactions at row:', i);
        break;
      }
      
      const transaction: any = {};
      headers.forEach((header, index) => {
        if (header && row[index] !== undefined) transaction[header] = row[index];
      });
      
      // Skip rows that might be summary rows
      if (Object.keys(transaction).length < 3) {
        console.log('Skipping summary row:', transaction);
        continue;
      }
      
      console.log('Raw domestic transaction:', transaction);
      transactions.push(transaction);
    }
  }
  
  if (foreignStartIndex !== -1) {
    const headers = sheetJson[foreignStartIndex];
    console.log('Foreign headers:', headers);
    
    for (let i = foreignStartIndex + 1; i < sheetJson.length; i++) {
      const row = sheetJson[i];
      // Skip TOTAL FOR DATE rows and other summary rows
      if (!row || row.length === 0 || !row[0]) {
        console.log('End of foreign transactions at row:', i);
        break;
      }
      
      if ((row[2] && typeof row[2] === 'string' && row[2].includes("TOTAL")) || 
          (row[0] && typeof row[0] === 'string' && row[0].includes('סך'))) {
        if (row[2] === "TOTAL FOR DATE") {
          console.log('Skipping total row:', i);
          continue;
        }
        console.log('End of foreign transactions at row:', i);
        break;
      }
      
      const transaction: any = {};
      headers.forEach((header, index) => {
        if (header && row[index] !== undefined) transaction[header] = row[index];
      });
      
      // Skip rows that might be summary rows
      if (Object.keys(transaction).length < 3) {
        console.log('Skipping summary row:', transaction);
        continue;
      }
      
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
  console.log('Final balance being returned:', finalBalance);
  
  return { 
    transactions: transformedTransactions,
    finalBalance: finalBalance
  };
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
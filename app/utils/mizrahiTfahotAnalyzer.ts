import * as XLSX from 'xlsx';
import { FieldMapping, VendorInfo, RowData, AnalysisResult } from './fileAnalyzer';

export const MIZRAHI_TFAHOT_FIELD_MAPPINGS: FieldMapping[] = [
  {
    source: 'תאריך',
    target: 'date',
    transform: (value: string) => {
      if (!value || typeof value !== 'string' || !value.includes('/')) {
        return value;
      }
      const [day, month, year] = value.trim().split('/');
      return `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    },
  },
  {
    source: 'סוג תנועה',
    target: 'payee_name',
  },
  {
    source: 'חובה',
    target: 'amount',
    transform: (value: string) => {
      if (!value || value.trim() === '' || value.trim() === '&nbsp;') {
        return 0;
      }
      // Convert to a negative number (expense) and multiply by 1000 for milliunits
      const numericValue = Number(value.trim().replace(/,/g, ''));
      return Number((numericValue * -1000).toFixed(2));
    },
  },
  {
    source: 'זכות',
    target: 'amount',
    transform: (value: string) => {
      if (!value || value.trim() === '' || value.trim() === '&nbsp;') {
        return 0;
      }
      // Keep as positive (income) and multiply by 1000 for milliunits
      const numericValue = Number(value.trim().replace(/,/g, ''));
      return Number((numericValue * 1000).toFixed(2));
    },
  },
  {
    source: 'אסמכתא',
    target: 'memo',
  },
];

export function isMizrahiTfahotFile(fileName: string, sheet: any): string | null {
  // For Excel files, check the content of cells for Mizrahi Tfahot markers
  if (sheet && typeof sheet === 'object') {
    // Convert the sheet to JSON to access its cell values
    const data = XLSX.utils.sheet_to_json<any>(sheet, { header: 'A', raw: false });

    // Check for specific Hebrew markers in the cells
    for (const row of data) {
      for (const cellKey of Object.keys(row)) {
        const cellValue = row[cellKey];
        if (typeof cellValue === 'string') {
          if (
            cellValue.includes('יתרה ותנועות בחשבון') ||
            cellValue.includes('מספר חשבון:') ||
            cellValue.includes('מזרחי טפחות')
          ) {
            return sheet['B3'].v;
          }
        }
      }
    }

    // Check if the first cell contains HTML with Mizrahi Tfahot markers
    if (sheet['A1'] && sheet['A1'].v && typeof sheet['A1'].v === 'string') {
      const htmlContent = sheet['A1'].v;
      if (
        htmlContent.includes('יתרה ותנועות בחשבון') &&
        (htmlContent.includes('מספר חשבון:') || htmlContent.includes('יתרה בחשבון'))
      ) {
        return 'Mizrahi Tfahot Account Statement';
      }
    }
  }

  return null;
}

/**
 * Extract balance from Mizrahi Tfahot statement HTML
 */
function extractBalance(htmlContent: string): number | null {
  try {
    // Look for balance pattern in the HTML content
    const balanceMatch = htmlContent.match(/יתרה בחשבון:\s*<\/td><td[^>]*>\s*([\d,.]+)/);

    if (balanceMatch && balanceMatch[1]) {
      // Clean and convert to number
      return Number(balanceMatch[1].replace(/,/g, ''));
    }
    return null;
  } catch (error) {
    console.error('Error extracting balance:', error);
    return null;
  }
}

/**
 * Extract HTML content from Excel cell structure
 */
function extractHTMLFromExcel(sheet: any): string {
  if (sheet && sheet['A1'] && sheet['A1'].v) {
    return sheet['A1'].v.toString();
  }

  // If we can't find HTML in A1, try to extract from the first non-empty cell
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
      if (sheet[cellRef] && sheet[cellRef].v) {
        const value = sheet[cellRef].v.toString();
        if (value.startsWith('<html') || value.includes('<table')) {
          return value;
        }
      }
    }
  }

  // If no HTML found, return empty string
  return '';
}

/**
 * Parse HTML table rows from Mizrahi Tfahot statement
 */
function parseHTMLTableRows(htmlContent: string): any[] {
  try {
    // First, identify the transactions table
    const tableStart = htmlContent.indexOf('<tr><td  style=background-color: #808080');
    if (tableStart === -1) return [];

    const tableSection = htmlContent.substring(tableStart);

    // Extract header row to identify column indices
    const headerMatch = tableSection.match(
      /<td[^>]*><b>\s*תאריך\s*<\/b><\/td>.*?<td[^>]*><b>\s*תאריך ערך\s*<\/b><\/td>.*?<td[^>]*><b>\s*סוג תנועה\s*<\/b><\/td>.*?<td[^>]*><b>\s*זכות\s*<\/b><\/td>.*?<td[^>]*><b>\s*חובה\s*<\/b><\/td>.*?<td[^>]*><b>\s*יתרה בשח\s*<\/b><\/td>.*?<td[^>]*><b>\s*אסמכתא\s*<\/b><\/td>/
    );

    if (!headerMatch) return [];

    // Find all transaction rows
    const transactions: any[] = [];
    let remainingContent = tableSection;

    // Regular expression to match transaction rows
    const rowRegex =
      /<tr>.*?<td[^>]*>\s*([\d/]+)\s*<\/td>.*?<td[^>]*>(.*?)<\/td>.*?<td[^>]*>(.*?)<\/td>.*?<td[^>]*>(.*?)<\/td>.*?<td[^>]*>(.*?)<\/td>.*?<td[^>]*>(.*?)<\/td>.*?<td[^>]*>(.*?)<\/td>/g;

    let match;
    while ((match = rowRegex.exec(remainingContent)) !== null) {
      // Skip header rows or summary rows
      if (
        match[1].includes('תאריך') ||
        match[3].includes('סך חיוב') ||
        !match[1].trim() ||
        !match[1].includes('/')
      ) {
        continue;
      }

      const transaction = {
        תאריך: match[1].trim(),
        'תאריך ערך': match[2].replace(/&nbsp;/g, '').trim(),
        'סוג תנועה': match[3].trim(),
        זכות: match[4].replace(/&nbsp;/g, '').trim(),
        חובה: match[5].replace(/&nbsp;/g, '').trim(),
        'יתרה בשח': match[6].replace(/&nbsp;/g, '').trim(),
        אסמכתא: match[7].trim(),
      };

      transactions.push(transaction);
    }

    return transactions;
  } catch (error) {
    console.error('Error parsing HTML table:', error);
    return [];
  }
}

export async function analyzeMizrahiTfahotFile(
  content: string | ArrayBuffer,
  fileName: string
): Promise<AnalysisResult> {
  console.log('Starting Mizrahi Tfahot file analysis for:', fileName);

  let transactions: any[] = [];
  let mizrahiIdentifier: string | null = null;
  let finalBalance: number | null = null;

  if (typeof content !== 'string') {
    // If it's an XLS file, we need to extract the data from the second sheet
    try {
      const workbook = XLSX.read(content, { type: 'array' });

      // Debug: Console table the first sheet
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      console.log('First sheet name:', workbook.SheetNames[0]);

      // Extract the value from cell C3 in the first sheet
      if (firstSheet && firstSheet['C3'] && firstSheet['C3'].v) {
        mizrahiIdentifier = String(firstSheet['C3'].v);
        console.log('Mizrahi identifier from cell C3:', mizrahiIdentifier);
      }

      // The actual content is in the second sheet with row 5 as the header row
      if (workbook.SheetNames.length > 1) {
        const secondSheet = workbook.Sheets[workbook.SheetNames[1]];
        console.log('Second sheet name:', workbook.SheetNames[1]);

        // Log all cells in the second sheet to help find the balance cell
        console.log('Debugging cells in second sheet:');
        if (secondSheet && secondSheet['!ref']) {
          const range = XLSX.utils.decode_range(secondSheet['!ref']);
          for (let r = range.s.r; r <= Math.min(range.e.r, 20); r++) {
            // Look at first 20 rows
            for (let c = range.s.c; c <= Math.min(range.e.c, 15); c++) {
              // Look at first 15 columns
              const cellRef = XLSX.utils.encode_cell({ r, c });
              if (secondSheet[cellRef] && secondSheet[cellRef].v !== undefined) {
                console.log(`Cell ${cellRef} = ${secondSheet[cellRef].v}`);
              }
            }
          }
        }

        // Try multiple possible locations for the balance
        const potentialBalanceCells = ['J5', 'J6', 'K5', 'K6', 'J10', 'K10', 'M5', 'M6'];
        for (const cellRef of potentialBalanceCells) {
          if (secondSheet && secondSheet[cellRef] && secondSheet[cellRef].v !== undefined) {
            const value = secondSheet[cellRef].v;
            console.log(`Found potential balance in cell ${cellRef}:`, value);

            if (typeof value === 'number') {
              finalBalance = value;
              console.log(`Using numeric balance from cell ${cellRef}:`, finalBalance);
              break;
            } else if (typeof value === 'string') {
              // Try to parse it as a number, removing any commas or other formatting
              const numericValue = Number(value.replace(/[^\d.-]/g, ''));
              if (!isNaN(numericValue)) {
                finalBalance = numericValue;
                console.log(`Using string-parsed balance from cell ${cellRef}:`, finalBalance);
                break;
              }
            }
          }
        }

        // Get all data from second sheet
        transactions = XLSX.utils.sheet_to_json(secondSheet, { header: 1 }).slice(5);
        console.log('Parsed transactions from second sheet:', transactions.length);
      } else {
        console.log('No second sheet found in the workbook');
        return { transactions: [] };
      }
    } catch (error) {
      console.error('Error processing Excel file:', error);
      throw new Error('Failed to process Mizrahi Tfahot Excel file');
    }
  } else {
    console.log('Content is a string, expected an Excel file');
    throw new Error('Mizrahi Tfahot analyzer expects an Excel file');
  }

  // Transform transactions to the required format
  const transformedTransactions = transactions.map((row) => {
    // Create a new transaction object
    const transaction: any = {};

    // Process credit and debit columns to determine amount
    let hasCredit = row['זכות'] && row['זכות'].toString().trim() !== '';
    let hasDebit = row['חובה'] && row['חובה'].toString().trim() !== '';

    // Apply field mappings
    MIZRAHI_TFAHOT_FIELD_MAPPINGS.forEach((mapping) => {
      // Skip the amount mapping that doesn't apply
      if (mapping.source === 'זכות' && hasDebit && !hasCredit) return;
      if (mapping.source === 'חובה' && hasCredit && !hasDebit) return;

      const value = row[mapping.source];
      if (value !== undefined) {
        transaction[mapping.target] = mapping.transform
          ? mapping.transform(value.toString())
          : value;
      }
    });

    // If we have both credit and debit, use the non-empty one
    if (transaction.amount === 0 && hasCredit) {
      const creditMapping = MIZRAHI_TFAHOT_FIELD_MAPPINGS.find((m) => m.source === 'זכות');
      if (creditMapping && creditMapping.transform) {
        transaction.amount = creditMapping.transform(row['זכות'].toString());
      }
    } else if (transaction.amount === 0 && hasDebit) {
      const debitMapping = MIZRAHI_TFAHOT_FIELD_MAPPINGS.find((m) => m.source === 'חובה');
      if (debitMapping && debitMapping.transform) {
        transaction.amount = debitMapping.transform(row['חובה'].toString());
      }
    }

    return transaction;
  });

  console.log('FINAL RESULT: Transformed transactions:', transformedTransactions.length);
  console.log('FINAL RESULT: Final balance:', finalBalance);

  return {
    transactions: transformedTransactions,
    finalBalance: finalBalance !== null ? finalBalance : undefined,
  };
}

export function getMizrahiTfahotVendorInfo(): VendorInfo {
  return {
    name: 'MizrahiTfahot',
    confidence: 1.0,
    uniqueIdentifiers: ['Mizrahi Tfahot Account Statement'],
    fieldMappings: MIZRAHI_TFAHOT_FIELD_MAPPINGS,
    analyzeFile: analyzeMizrahiTfahotFile,
    isVendorFile: isMizrahiTfahotFile,
  };
}

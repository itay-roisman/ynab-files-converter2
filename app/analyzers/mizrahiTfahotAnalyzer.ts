import * as XLSX from 'xlsx';

import { AnalysisResult, FieldMapping, RowData, VendorInfo } from './fileAnalyzer';

// Prefix unused functions with _ to satisfy linting rules
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
      const numericValue = Number(value.toString().trim().replace(/,/g, ''));
      return Number((numericValue * -1000).toFixed(0));
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
      const numericValue = Number(value.toString().trim().replace(/,/g, ''));
      return Number((numericValue * 1000).toFixed(0));
    },
  },
  {
    source: 'אסמכתא',
    target: 'memo',
  },
];

export function isMizrahiTfahotFile(fileName: string, sheet: XLSX.WorkSheet): string | null {
  // For Excel files, check the content of cells for Mizrahi Tfahot markers
  if (sheet && typeof sheet === 'object') {
    // Convert the sheet to JSON to access its cell values
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      header: 'A',
      raw: false,
    });

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
            return sheet['B3']?.v?.toString() || 'Mizrahi Tfahot Account';
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

// Exported for testing
export function extractBalanceFromCell(value: any): number | null {
  debugger;
  if (typeof value === 'number') {
    return value;
  } else if (typeof value === 'string') {
    // Try to parse it as a number, removing any commas, currency symbols, etc.
    const numericValue = Number(value.replace(/[^\d.-]/g, ''));
    if (!isNaN(numericValue)) {
      return numericValue;
    }
    // Return 0 instead of null for non-numeric strings
    return 0;
  }
  return null;
}

// Exported for testing
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

      // Process credit and debit columns to determine amount
      const hasCredit = row['זכות'] && String(row['זכות']).trim() !== '';
      const hasDebit = row['חובה'] && String(row['חובה']).trim() !== '';

      // Apply field mappings
      MIZRAHI_TFAHOT_FIELD_MAPPINGS.forEach((mapping) => {
        // Skip the amount mapping that doesn't apply
        if (mapping.source === 'זכות' && hasDebit && !hasCredit) return;
        if (mapping.source === 'חובה' && hasCredit && !hasDebit) return;

        const value = row[mapping.source];
        if (value !== undefined) {
          // @ts-expect-error - We're handling various property assignments
          transaction[mapping.target] = mapping.transform
            ? mapping.transform(String(value))
            : value;
        }
      });

      // If we have both credit and debit, use the non-empty one
      if (transaction.amount === 0 && hasCredit) {
        const creditMapping = MIZRAHI_TFAHOT_FIELD_MAPPINGS.find((m) => m.source === 'זכות');
        if (creditMapping && creditMapping.transform) {
          transaction.amount = creditMapping.transform(String(row['זכות']));
        }
      } else if (transaction.amount === 0 && hasDebit) {
        const debitMapping = MIZRAHI_TFAHOT_FIELD_MAPPINGS.find((m) => m.source === 'חובה');
        if (debitMapping && debitMapping.transform) {
          transaction.amount = debitMapping.transform(String(row['חובה']));
        }
      }

      return transaction;
    });
}

// Exported for testing
export function findBalanceInWorkbook(workbook: XLSX.WorkBook): number | null {
  try {
    if (workbook.SheetNames.length > 1) {
      const transactionSheet = workbook.Sheets[workbook.SheetNames[1]];

      // Check various common balance cells
      const potentialBalanceCells = ['B1'];
      for (const cellRef of potentialBalanceCells) {
        if (transactionSheet[cellRef] && transactionSheet[cellRef].v !== undefined) {
          return transactionSheet[cellRef].v;
        }
      }
    }
    return null;
  } catch (error) {
    console.error('Error finding balance in workbook:', error);
    return null;
  }
}

// Exported for testing
export function extractTransactionsFromWorkbook(
  workbook: XLSX.WorkBook
): Record<string, string | number>[] {
  let transactions: Record<string, string | number>[] = [];

  try {
    // Determine which sheet has the transactions
    const transactionSheetIndex = workbook.SheetNames.length > 1 ? 1 : 0;
    const transactionSheet = workbook.Sheets[workbook.SheetNames[transactionSheetIndex]];

    if (transactionSheet && transactionSheet['!ref']) {
      const sheetRange = XLSX.utils.decode_range(transactionSheet['!ref']);

      // Look for headers row
      let headers: string[] = [];
      let startRow = 0;

      // Scan first 20 rows to find headers
      for (let r = 0; r < Math.min(sheetRange.e.r, 20); r++) {
        const headersRow: string[] = [];
        for (let c = 0; c < Math.min(sheetRange.e.c, 15); c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          if (transactionSheet[cellRef] && transactionSheet[cellRef].v !== undefined) {
            headersRow.push(String(transactionSheet[cellRef].v));
          }
        }

        // Check if this row has the expected headers
        if (
          headersRow.includes('תאריך') &&
          (headersRow.includes('סוג תנועה') || headersRow.includes('פרטים')) &&
          (headersRow.includes('חובה') || headersRow.includes('זכות'))
        ) {
          headers = headersRow;
          startRow = r + 1; // Start from the next row
          console.warn('Found headers row at:', r, 'Headers:', headers);
          break;
        }
      }

      // Extract transactions using headers
      if (headers.length > 0) {
        const dateIndex = headers.indexOf('תאריך');
        const payeeIndex =
          headers.indexOf('סוג תנועה') !== -1
            ? headers.indexOf('סוג תנועה')
            : headers.indexOf('פרטים');
        const debitIndex = headers.indexOf('חובה');
        const creditIndex = headers.indexOf('זכות');
        const memoIndex = headers.indexOf('אסמכתא');

        for (let r = startRow; r <= sheetRange.e.r; r++) {
          const transactionRow: Record<string, string | number> = {};

          // Get date
          if (dateIndex >= 0) {
            const dateCellRef = XLSX.utils.encode_cell({ r, c: dateIndex });
            if (transactionSheet[dateCellRef] && transactionSheet[dateCellRef].v) {
              transactionRow['תאריך'] = String(transactionSheet[dateCellRef].v);
            }
          }

          // Stop if no date (end of transactions)
          if (!transactionRow['תאריך']) {
            continue;
          }

          // Get payee
          if (payeeIndex >= 0) {
            const payeeCellRef = XLSX.utils.encode_cell({ r, c: payeeIndex });
            if (transactionSheet[payeeCellRef] && transactionSheet[payeeCellRef].v) {
              transactionRow['סוג תנועה'] = String(transactionSheet[payeeCellRef].v);
            }
          }

          // Get debit
          if (debitIndex >= 0) {
            const debitCellRef = XLSX.utils.encode_cell({ r, c: debitIndex });
            if (transactionSheet[debitCellRef] && transactionSheet[debitCellRef].v) {
              transactionRow['חובה'] = transactionSheet[debitCellRef].v;
            }
          }

          // Get credit
          if (creditIndex >= 0) {
            const creditCellRef = XLSX.utils.encode_cell({ r, c: creditIndex });
            if (transactionSheet[creditCellRef] && transactionSheet[creditCellRef].v) {
              transactionRow['זכות'] = transactionSheet[creditCellRef].v;
            }
          }

          // Get memo
          if (memoIndex >= 0) {
            const memoCellRef = XLSX.utils.encode_cell({ r, c: memoIndex });
            if (transactionSheet[memoCellRef] && transactionSheet[memoCellRef].v) {
              transactionRow['אסמכתא'] = String(transactionSheet[memoCellRef].v);
            }
          }

          // Only add rows with date and either debit or credit
          if (transactionRow['תאריך'] && (transactionRow['חובה'] || transactionRow['זכות'])) {
            transactions.push(transactionRow);
          }
        }
      } else {
        // Fallback to using sheet_to_json
        transactions = XLSX.utils.sheet_to_json(transactionSheet, { raw: false });
      }
    }

    console.warn('Extracted transactions:', transactions.length);
    return transactions;
  } catch (error) {
    console.error('Error extracting transactions:', error);
    return [];
  }
}

export async function analyzeMizrahiTfahotFile(
  content: string | ArrayBuffer,
  _fileName: string // Prefix with underscore to mark as intentionally unused
): Promise<AnalysisResult> {
  let transactions: Record<string, string | number>[] = [];
  let finalBalance: number | null = null;

  if (typeof content !== 'string') {
    // If it's an XLS file, we need to extract the data from the sheet
    try {
      const workbook = XLSX.read(content, { type: 'array' });

      // Log sheet information
      console.table(
        workbook.SheetNames.map((name, index) => ({
          index,
          name,
          ref: workbook.Sheets[name]['!ref'] || 'N/A',
          cells: Object.keys(workbook.Sheets[name]).filter((key) => !key.startsWith('!')).length,
        }))
      );

      // Extract identifier from the first sheet if available
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (firstSheet && firstSheet['C3'] && firstSheet['C3'].v) {
        const mizrahiIdentifier = String(firstSheet['C3'].v);
        console.warn('Mizrahi identifier from cell C3:', mizrahiIdentifier);
      }

      // Find balance in workbook
      finalBalance = findBalanceInWorkbook(workbook);

      // Extract transactions
      transactions = extractTransactionsFromWorkbook(workbook);
    } catch (error) {
      console.error('Error processing Excel file:', error);
      throw new Error('Failed to process Mizrahi Tfahot Excel file');
    }
  } else {
    console.warn('Content is a string, expected an Excel file');
    throw new Error('Mizrahi Tfahot analyzer expects an Excel file');
  }

  // Transform transactions to the required format
  const transformedTransactions = transformTransactions(transactions);

  console.warn('FINAL RESULT: Transformed transactions:', transformedTransactions.length);

  // Make absolutely sure the final balance is not null, fallback to 0 if needed
  if (finalBalance === null) {
    console.warn('No final balance found, using default 0 value');
    finalBalance = 0;
  }

  console.warn('FINAL RESULT: Final balance (original):', finalBalance);

  return {
    transactions: transformedTransactions,
    finalBalance,
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

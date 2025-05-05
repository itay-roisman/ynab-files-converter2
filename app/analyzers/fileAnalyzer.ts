import Papa from 'papaparse';
import * as XLSX from 'xlsx';

import { getCalVendorInfo } from './calAnalyzer';
import { getDiscountVendorInfo } from './discountAnalyzer';
import { getIsracardVendorInfo } from './isracardAnalyzer';
import { getMaxVendorInfo } from './maxAnalyzer';
import { getMizrahiTfahotVendorInfo } from './mizrahiTfahotAnalyzer';
import { getPoalimVendorInfo } from './poalimAnalyzer';

export interface FieldMapping {
  source: string;
  target: string;
  transform?: (value: any) => any;
}

export interface VendorInfo {
  name: string;
  confidence: number;
  uniqueIdentifiers: string[];
  fieldMappings: FieldMapping[];
  analyzeFile: (content: string | ArrayBuffer, fileName: string) => Promise<AnalysisResult>;
  isVendorFile: (fileName: string, sheet: any) => string | null;
}

export interface FileAnalysis {
  fileName: string;
  vendorInfo: VendorInfo | null;
  error?: string;
  data?: any;
  finalBalance?: number; // Add this property to expose the final balance
  identifier: string | null;
}

export interface RowData {
  date: string;
  amount: number;
  payee_name: string;
  memo?: string;
}

export interface AnalysisResult {
  transactions: RowData[];
  finalBalance?: number;
}

interface VendorConfig {
  patterns: string[];
  confidence: number;
  fieldMappings?: FieldMapping[];
  analyzeFile?: (content: string | ArrayBuffer, fileName: string) => Promise<any>;
}

// Common vendor identifiers
const VENDOR_IDENTIFIERS: Record<string, VendorConfig> = {
  AMAZON: {
    patterns: ['AMAZON', 'AMZN', 'AMAZON.COM'],
    confidence: 0.9,
  },
  STARBUCKS: {
    patterns: ['STARBUCKS', 'SBUX'],
    confidence: 0.9,
  },
  NETFLIX: {
    patterns: ['NETFLIX', 'NETFLIX.COM'],
    confidence: 0.9,
  },
  SPOTIFY: {
    patterns: ['SPOTIFY', 'SPOTIFY USA'],
    confidence: 0.9,
  },
  APPLE: {
    patterns: ['APPLE', 'APPLE.COM', 'ITUNES'],
    confidence: 0.9,
  },
  GOOGLE: {
    patterns: ['GOOGLE', 'GOOGLE *', 'GOOGLE.COM'],
    confidence: 0.9,
  },
};

function findVendorInText(text: string): VendorInfo | null {
  const upperText = text.toUpperCase();

  for (const [vendorName, info] of Object.entries(VENDOR_IDENTIFIERS)) {
    for (const pattern of info.patterns) {
      if (upperText.includes(pattern)) {
        return {
          name: vendorName,
          confidence: info.confidence,
          uniqueIdentifiers: [pattern],
          fieldMappings: info.fieldMappings || [],
          analyzeFile: info.analyzeFile,
        };
      }
    }
  }

  return null;
}

// Helper function to detect the CSV delimiter
function detectDelimiter(csvText: string): string {
  const firstLine = csvText.split('\n')[0];

  const delimiters = [',', ';', '\t', '|'];
  let bestDelimiter = ','; // Default to comma
  let maxCount = 0;

  for (const delimiter of delimiters) {
    const count = (firstLine.match(new RegExp(delimiter, 'g')) || []).length;
    if (count > maxCount) {
      maxCount = count;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

export async function analyzeCSVContent(
  content: string,
  fileName: string
): Promise<AnalysisResult> {
  // Remove BOM if present
  const contentWithoutBOM = content.replace(/^\uFEFF/, '');

  const detectedDelimiter = detectDelimiter(contentWithoutBOM);

  let results: any[] = [];
  try {
    results = Papa.parse(contentWithoutBOM, {
      header: true,
      skipEmptyLines: true,
      delimiter: detectedDelimiter,
    }).data;
  } catch (error) {
    throw new Error(
      `Failed to parse CSV file: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Fallback to parsing without headers if we got very few results
  if (results.length < 2) {
    try {
      const noHeaderResults = Papa.parse(contentWithoutBOM, {
        header: false,
        skipEmptyLines: true,
        delimiter: detectedDelimiter,
      }).data;

      // If we have at least a header and a row
      if (noHeaderResults.length >= 2) {
        const headers = noHeaderResults[0];
        results = noHeaderResults.slice(1).map((row) => {
          const obj: Record<string, any> = {};
          headers.forEach((header: string, i: number) => {
            obj[header] = row[i];
          });
          return obj;
        });
      }
    } catch (error) {
      // Still failed, just continue with the original results
    }
  }

  // Now try to identify the file format based on the columns
  for (const analyzer of REGISTERED_ANALYZERS) {
    const isMatch = analyzer.isVendorFile(fileName, results);
    if (isMatch) {
      return analyzer.analyzeFile(content, fileName);
    }
  }

  // Could not determine the file format
  throw new Error('Unknown file format. Could not determine bank or credit card format.');
}

function analyzeExcelContent(
  buffer: ArrayBuffer,
  fileName: string
): { vendorInfo: VendorInfo | null; identifier: string | null } {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<RowData>(firstSheet);
  const headers = Object.keys(data[0] || {});

  // Check if this is a CAL file
  const calVendorInfo = getCalVendorInfo();
  const calIdentifier = calVendorInfo.isVendorFile?.(fileName, firstSheet);
  if (calIdentifier) {
    return { vendorInfo: calVendorInfo, identifier: calIdentifier };
  }

  // Check if this is an ISRACARD file
  const isracardVendorInfo = getIsracardVendorInfo();
  const isracardIdentifier = isracardVendorInfo.isVendorFile?.(fileName, firstSheet);
  if (isracardIdentifier) {
    return { vendorInfo: isracardVendorInfo, identifier: isracardIdentifier };
  }

  // Check if this is a MAX file
  const maxVendorInfo = getMaxVendorInfo();
  const maxIdentifier = maxVendorInfo.isVendorFile?.(fileName, firstSheet);
  if (maxIdentifier) {
    return { vendorInfo: maxVendorInfo, identifier: maxIdentifier };
  }

  // Check if this is a MIZRAHI TFAHOT file
  const mizrahiTfahotVendorInfo = getMizrahiTfahotVendorInfo();
  const mizrahiTfahotIdentifier = mizrahiTfahotVendorInfo.isVendorFile?.(fileName, firstSheet);
  if (mizrahiTfahotIdentifier) {
    return { vendorInfo: mizrahiTfahotVendorInfo, identifier: mizrahiTfahotIdentifier };
  }

  // Check if this is a DISCOUNT file
  const discountVendorInfo = getDiscountVendorInfo();
  const discountIdentifier = discountVendorInfo.isVendorFile?.(fileName, firstSheet);
  if (discountIdentifier) {
    return { vendorInfo: discountVendorInfo, identifier: discountIdentifier };
  }

  // Look for vendor information in common columns
  const commonColumns = ['description', 'merchant', 'vendor', 'payee', 'name'];

  for (const row of data) {
    for (const column of commonColumns) {
      const value = row[column];
      if (value && typeof value === 'string') {
        const vendorInfo = findVendorInText(value);
        if (vendorInfo) {
          return { vendorInfo, identifier: value };
        }
      }
    }
  }

  return { vendorInfo: null, identifier: null };
}

export async function analyzeFile(file: File): Promise<FileAnalysis> {
  try {
    let vendorInfo: VendorInfo | null = null;
    let data: any = null;
    let identifier: string | null = null;
    let finalBalance: number | undefined = undefined;
    let transactions: RowData[] | undefined = undefined;

    if (file.name.endsWith('.csv')) {
      const content = await file.text();
      const analysis = analyzeCSVContent(content, file.name);
      vendorInfo = analysis.vendorInfo;
      identifier = analysis.identifier;

      if (vendorInfo?.analyzeFile) {
        data = await vendorInfo.analyzeFile(content, file.name);
        // Extract final balance and transactions
        finalBalance = data?.finalBalance;
        transactions = data?.transactions;
      }
    } else if (
      file.name.toLowerCase().endsWith('.xls') ||
      file.name.toLowerCase().endsWith('.xlsx') ||
      file.name.toLowerCase().endsWith('.xlsm')
    ) {
      const buffer = await file.arrayBuffer();
      const analysis = analyzeExcelContent(buffer, file.name);
      vendorInfo = analysis.vendorInfo;
      identifier = analysis.identifier;

      if (vendorInfo?.analyzeFile) {
        data = await vendorInfo.analyzeFile(buffer, file.name);
        // Extract final balance and transactions
        finalBalance = data?.finalBalance;
        transactions = data?.transactions;
      }
    }

    // Ensure data has the transactions at the top level
    if (data && transactions) {
      data.transactions = transactions;
    }

    return {
      fileName: file.name,
      vendorInfo,
      data,
      finalBalance,
      identifier,
    };
  } catch (error) {
    return {
      fileName: file.name,
      vendorInfo: null,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      identifier: null,
    };
  }
}

export async function analyzeFiles(files: File[]): Promise<FileAnalysis[]> {
  return Promise.all(files.map((file) => analyzeFile(file)));
}

// Register all analyzers here
const REGISTERED_ANALYZERS = [
  getCalVendorInfo(),
  getIsracardVendorInfo(),
  getMaxVendorInfo(),
  getMizrahiTfahotVendorInfo(),
  getPoalimVendorInfo(),
  getDiscountVendorInfo(),
];

import Papa from 'papaparse';
import * as XLSX from 'xlsx';

import { getCalVendorInfo } from './calAnalyzer';
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
        // Only return a vendor if it has both required functions
        if (!info.analyzeFile) {
          continue;
        }

        return {
          name: vendorName,
          confidence: info.confidence,
          uniqueIdentifiers: [pattern],
          fieldMappings: info.fieldMappings || [],
          analyzeFile: info.analyzeFile,
          isVendorFile: () => null, // Add a default implementation
        };
      }
    }
  }

  return null;
}

// Helper function to detect the delimiter in CSV files
function detectDelimiter(text: string): string {
  const possibleDelimiters = [',', ';', '\t', '|'];
  const counts = possibleDelimiters.map((delimiter) => {
    const count = text
      .split('\n')
      .slice(0, 5)
      .reduce((total, line) => {
        return total + (line.match(new RegExp(delimiter, 'g')) || []).length;
      }, 0);
    return { delimiter, count };
  });

  const max = counts.reduce((max, current) => (current.count > max.count ? current : max), {
    delimiter: ',',
    count: 0,
  });
  return max.delimiter;
}

export async function analyzeCSVContent(
  content: string,
  fileName: string
): Promise<AnalysisResult> {
  // Remove BOM if present
  const contentWithoutBOM = content.replace(/^\uFEFF/, '');

  // Define analyzers to use
  const analyzers = [getPoalimVendorInfo()];
  // For other files, continue with normal parsing
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

  // Now try to identify the file format based on the columns for non-Poalim files
  for (const analyzer of analyzers) {
    const isMatch = analyzer.isVendorFile(fileName, results);
    if (isMatch) {
      return analyzer.analyzeFile(content, fileName);
    }
  }

  // Default return when no analyzers match
  return {
    transactions: [],
    finalBalance: undefined,
  };
}

function analyzeExcelContent(
  buffer: ArrayBuffer,
  fileName: string
): { vendorInfo: VendorInfo | null; identifier: string | null } {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet);
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

  // Look for vendor information in common columns
  const commonColumns = ['description', 'merchant', 'vendor', 'payee', 'name'];

  for (const row of data) {
    for (const column of commonColumns) {
      if (column in row) {
        const value = row[column];
        if (value && typeof value === 'string') {
          const vendorInfo = findVendorInText(value);
          if (vendorInfo) {
            return { vendorInfo, identifier: value };
          }
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
      try {
        const content = await file.text();

        const poalimVendorInfo = getPoalimVendorInfo();

        // Use the isPoalimFile method to extract the identifier
        const headers = Papa.parse(content.substring(0, 500), {
          header: true,
          preview: 1,
        }).data;
        identifier = poalimVendorInfo.isVendorFile(file.name, headers);

        // First try to analyze the content
        const analysisResult = await analyzeCSVContent(content, file.name);

        // If successful, we have the transactions and possibly final balance
        transactions = analysisResult.transactions;
        finalBalance = analysisResult.finalBalance;

        // The data is just the analysis result
        data = analysisResult;
      } catch (error) {
        throw new Error(
          `Failed to analyze CSV file: ${error instanceof Error ? error.message : String(error)}`
        );
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

    // Debug info
    console.log('File analysis completed:', {
      fileName: file.name,
      vendorInfo: vendorInfo?.name,
      transactions: transactions?.length,
      finalBalance: finalBalance,
    });

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

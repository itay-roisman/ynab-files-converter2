import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { getPoalimVendorInfo } from './poalimAnalyzer';
import { getIsracardVendorInfo } from './isracardAnalyzer';
import { getMaxVendorInfo } from './maxAnalyzer';
import { getCalVendorInfo } from './calAnalyzer';

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
  finalBalance?: number;  // Add this property to expose the final balance
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
  'AMAZON': {
    patterns: ['AMAZON', 'AMZN', 'AMAZON.COM'],
    confidence: 0.9
  },
  'STARBUCKS': {
    patterns: ['STARBUCKS', 'SBUX'],
    confidence: 0.9
  },
  'NETFLIX': {
    patterns: ['NETFLIX', 'NETFLIX.COM'],
    confidence: 0.9
  },
  'SPOTIFY': {
    patterns: ['SPOTIFY', 'SPOTIFY USA'],
    confidence: 0.9
  },
  'APPLE': {
    patterns: ['APPLE', 'APPLE.COM', 'ITUNES'],
    confidence: 0.9
  },
  'GOOGLE': {
    patterns: ['GOOGLE', 'GOOGLE *', 'GOOGLE.COM'],
    confidence: 0.9
  }
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
          fieldMappings: info.fieldMappings,
          analyzeFile: info.analyzeFile
        };
      }
    }
  }
  
  return null;
}

function analyzeCSVContent(content: string, fileName: string): { vendorInfo: VendorInfo | null; identifier: string | null } {
  console.log('Analyzing CSV content:', {
    fileName,
    contentPreview: content.substring(0, 200)
  });

  const result = Papa.parse<RowData>(content, {
    header: true,
    skipEmptyLines: true
  });

  console.log('CSV parse result:', {
    errors: result.errors,
    fields: result.meta.fields,
    dataPreview: result.data.slice(0, 2)
  });

  if (result.errors.length > 0) {
    return { vendorInfo: null, identifier: null };
  }

  // Check if this is a POALIM file
  const poalimVendorInfo = getPoalimVendorInfo();
  const poalimIdentifier = poalimVendorInfo.isVendorFile?.(fileName, result.meta.fields || []);
  if (poalimIdentifier) {
    return { vendorInfo: poalimVendorInfo, identifier: poalimIdentifier };
  }

  // Look for vendor information in common columns
  const commonColumns = ['description', 'merchant', 'vendor', 'payee', 'name'];
  
  for (const row of result.data) {
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

function analyzeExcelContent(buffer: ArrayBuffer, fileName: string): { vendorInfo: VendorInfo | null; identifier: string | null } {
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

    if (file.name.endsWith('.csv')) {
      const content = await file.text();
      const analysis = analyzeCSVContent(content, file.name);
      vendorInfo = analysis.vendorInfo;
      identifier = analysis.identifier;
      
      if (vendorInfo?.analyzeFile) {
        data = await vendorInfo.analyzeFile(content, file.name);
        // Extract final balance if it exists
        finalBalance = data?.finalBalance;
      }
    } else if (file.name.toLowerCase().endsWith('.xls') || file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xlsm')) {
      const buffer = await file.arrayBuffer();
      const analysis = analyzeExcelContent(buffer, file.name);
      vendorInfo = analysis.vendorInfo;
      identifier = analysis.identifier;
      
      if (vendorInfo?.analyzeFile) {
        data = await vendorInfo.analyzeFile(buffer, file.name);
        // Extract final balance if it exists
        finalBalance = data?.finalBalance;
      }
    }

    return {
      fileName: file.name,
      vendorInfo,
      data,
      finalBalance,
      identifier
    };
  } catch (error) {
    return {
      fileName: file.name,
      vendorInfo: null,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      identifier: null
    };
  }
}

export async function analyzeFiles(files: File[]): Promise<FileAnalysis[]> {
  return Promise.all(files.map(file => analyzeFile(file)));
}
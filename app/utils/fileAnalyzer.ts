import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { isPoalimFile, getPoalimVendorInfo } from './poalimAnalyzer';

export interface FieldMapping {
  source: string;
  target: string;
  transform?: (value: any) => any;
}

export interface VendorInfo {
  name: string;
  confidence: number;
  uniqueIdentifiers: string[];
  fieldMappings?: FieldMapping[];
  analyzeFile?: (content: string, fileName: string) => Promise<any>;
  isVendorFile?: (fileName: string, headers: string[]) => boolean;
}

export interface FileAnalysis {
  fileName: string;
  vendorInfo: VendorInfo | null;
  error?: string;
  data?: any;
}

export interface RowData {
  [key: string]: string | number | null;
}

interface VendorConfig {
  patterns: string[];
  confidence: number;
  fieldMappings?: FieldMapping[];
  analyzeFile?: (content: string, fileName: string) => Promise<any>;
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

function analyzeCSVContent(content: string, fileName: string): VendorInfo | null {
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
    return null;
  }

  // Check if this is a POALIM file
  const poalimVendorInfo = getPoalimVendorInfo();
  if (poalimVendorInfo.isVendorFile?.(fileName, result.meta.fields || [])) {
    return poalimVendorInfo;
  }

  // Look for vendor information in common columns
  const commonColumns = ['description', 'merchant', 'vendor', 'payee', 'name'];
  
  for (const row of result.data) {
    for (const column of commonColumns) {
      const value = row[column];
      if (value && typeof value === 'string') {
        const vendorInfo = findVendorInText(value);
        if (vendorInfo) {
          return vendorInfo;
        }
      }
    }
  }

  return null;
}

function analyzeExcelContent(buffer: ArrayBuffer): VendorInfo | null {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<RowData>(firstSheet);

  // Look for vendor information in common columns
  const commonColumns = ['description', 'merchant', 'vendor', 'payee', 'name'];
  
  for (const row of data) {
    for (const column of commonColumns) {
      const value = row[column];
      if (value && typeof value === 'string') {
        const vendorInfo = findVendorInText(value);
        if (vendorInfo) {
          return vendorInfo;
        }
      }
    }
  }

  return null;
}

export async function analyzeFile(file: File): Promise<FileAnalysis> {
  try {
    let vendorInfo: VendorInfo | null = null;
    let data: any = null;

    if (file.name.endsWith('.csv')) {
      const content = await file.text();
      vendorInfo = analyzeCSVContent(content, file.name);
      
      if (vendorInfo?.analyzeFile) {
        data = await vendorInfo.analyzeFile(content, file.name);
      }
    } else if (file.name.endsWith('.xls') || file.name.endsWith('.xlsx')) {
      const buffer = await file.arrayBuffer();
      vendorInfo = analyzeExcelContent(buffer);
    }

    return {
      fileName: file.name,
      vendorInfo,
      data
    };
  } catch (error) {
    return {
      fileName: file.name,
      vendorInfo: null,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

export async function analyzeFiles(files: File[]): Promise<FileAnalysis[]> {
  return Promise.all(files.map(file => analyzeFile(file)));
} 
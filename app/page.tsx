'use client';

import { useState, useEffect } from 'react';
import FileUpload from './components/FileUpload';
import YNABIntegration from './components/YNABIntegration';
import { analyzeFiles, FileAnalysis, FieldMapping } from './utils/fileAnalyzer';
import { YNABTransaction } from './utils/ynabService';
import styles from './page.module.css';

interface TransformedRow {
  [key: string]: string | number | null;
}

export default function Home() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileAnalyses, setFileAnalyses] = useState<FileAnalysis[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [transactions, setTransactions] = useState<YNABTransaction[]>([]);
  const [isYNABConnected, setIsYNABConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const accessToken = localStorage.getItem('ynab_access_token');
    setIsYNABConnected(!!accessToken);
    setIsLoading(false);
  }, []);

  const handleFilesSelected = async (files: File[]) => {
    setSelectedFiles(files);
    setIsAnalyzing(true);
    
    try {
      const analyses = await analyzeFiles(files);
      setFileAnalyses(analyses);
      
      // Extract transactions from analyses
      const transactions = analyses.flatMap(analysis => {
        if (!analysis.data) return [];
        return analysis.data.map((row: any) => {
          // Ensure required fields are present and not null
          const amount = row.amount ? Number(row.amount) : 0;
          const date = row.date || new Date().toISOString().split('T')[0];
          const payee = row.payee_name || 'Unknown Payee';
          
          return {
            account_id: '', // This will be set later in YNABIntegration
            date,
            amount,
            payee_name: payee,
            memo: row.memo || '',
            cleared: 'uncleared' as const,
            approved: false
          };
        });
      });
      
      setTransactions(transactions);
    } catch (error) {
      console.error('Error analyzing files:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleYNABSuccess = () => {
    alert('Transactions successfully sent to YNAB!');
  };

  const handleYNABError = (error: Error) => {
    alert(`Error sending to YNAB: ${error.message}`);
  };

  const renderFieldMappings = (mappings: FieldMapping[]) => {
    return (
      <div className={styles.fieldMappings}>
        <h3>Field Mappings:</h3>
        <ul>
          {mappings.map((mapping, index) => (
            <li key={index}>
              <span className={styles.sourceField}>{mapping.source}</span>
              <span className={styles.mappingArrow}>→</span>
              <span className={styles.targetField}>{mapping.target}</span>
              {mapping.transform && (
                <span className={styles.transformInfo}> (transformed)</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderDataPreview = (data: TransformedRow[]) => {
    if (!data || data.length === 0) return null;

    return (
      <div className={styles.dataPreview}>
        <h3>Data Preview:</h3>
        <div className={styles.previewTable}>
          <table>
            <thead>
              <tr>
                {Object.keys(data[0]).map((key) => (
                  <th key={key}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 5).map((row, index) => (
                <tr key={index}>
                  {Object.values(row).map((value, i) => (
                    <td key={i}>{String(value)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > 5 && (
            <div className={styles.moreRows}>
              ... and {data.length - 5} more rows
            </div>
          )}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <h1>Loading...</h1>
      </div>
    );
  }

  if (!isYNABConnected) {
    return (
      <div className={styles.container}>
        <h1>Connect to YNAB</h1>
        <p>Please connect your YNAB account to continue.</p>
        <YNABIntegration onSuccess={() => setIsYNABConnected(true)} />
      </div>
    );
  }

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>File Converter to YNAB</h1>
        <p className={styles.description}>
          Upload your CSV or Excel files to convert them to YNAB format
        </p>
        
        <FileUpload onFilesSelected={handleFilesSelected} />
        
        {isAnalyzing && (
          <div className={styles.analyzing}>
            <p>Analyzing files...</p>
          </div>
        )}
        
        {fileAnalyses.length > 0 && (
          <div className={styles.fileList}>
            <h2>File Analysis Results:</h2>
            <ul>
              {fileAnalyses.map((analysis, index) => (
                <li key={index} className={styles.fileItem}>
                  <div className={styles.fileName}>{analysis.fileName}</div>
                  {analysis.error ? (
                    <div className={styles.error}>Error: {analysis.error}</div>
                  ) : analysis.vendorInfo ? (
                    <div className={styles.vendorInfo}>
                      <div className={styles.vendorName}>
                        Vendor: {analysis.vendorInfo.name}
                      </div>
                      <div className={styles.confidence}>
                        Confidence: {(analysis.vendorInfo.confidence * 100).toFixed(0)}%
                      </div>
                      <div className={styles.identifiers}>
                        Identified by: {analysis.vendorInfo.uniqueIdentifiers.join(', ')}
                      </div>
                      {analysis.identifier && (
                        <div className={styles.identifier}>
                          Identifier: {analysis.identifier}
                        </div>
                      )}
                      {analysis.vendorInfo.fieldMappings && renderFieldMappings(analysis.vendorInfo.fieldMappings)}
                      {analysis.data && renderDataPreview(analysis.data as TransformedRow[])}
                    </div>
                  ) : (
                    <div className={styles.noVendor}>No vendor identified</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {transactions.length > 0 && (
          <YNABIntegration
            transactions={transactions}
            onSuccess={handleYNABSuccess}
            onError={handleYNABError}
            identifier={fileAnalyses[0]?.identifier || undefined}
          />
        )}
      </div>
    </main>
  );
}

import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { analyzeFiles, FileAnalysis } from '../utils/fileAnalyzer';
import styles from './FileUpload.module.css';

interface FileUploadProps {
  onAnalysisComplete?: (analysis: FileAnalysis[]) => void;
}

export default function FileUpload({ onAnalysisComplete }: FileUploadProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<FileAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(acceptedFiles);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
    },
  });

  useEffect(() => {
    async function processFiles() {
      if (files.length === 0) return;

      try {
        setLoading(true);
        const results = await analyzeFiles(files);
        setAnalysis(results);

        if (onAnalysisComplete) {
          onAnalysisComplete(results);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
        console.error('Error analyzing files:', err);
      } finally {
        setLoading(false);
      }
    }

    processFiles();
  }, [files, onAnalysisComplete]);

  return (
    <div className={styles.container}>
      <div
        {...getRootProps()}
        className={`${styles.dropzone} ${isDragActive ? styles.active : ''}`}
      >
        <input {...getInputProps()} />
        {isDragActive ? (
          <p>Drop the files here...</p>
        ) : (
          <div className={styles.uploadPrompt}>
            <img src="/file.svg" alt="Upload" className={styles.uploadIcon} />
            <p>Drag & drop files here, or click to select files</p>
            <p className={styles.fileTypeHint}>Supported formats: CSV, XLS, XLSX</p>
          </div>
        )}
      </div>

      {loading && <p className={styles.status}>Analyzing files...</p>}

      {error && <p className={styles.error}>{error}</p>}

      {files.length > 0 && !loading && (
        <div className={styles.fileList}>
          <h3>Selected Files:</h3>
          <ul>
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`}>
                {file.name} ({Math.round(file.size / 1024)} KB)
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.length > 0 && !loading && (
        <div className={styles.analysisResults}>
          <h3>Analysis Results:</h3>
          {analysis.map((result, index) => (
            <div key={`${result.fileName}-${index}`} className={styles.analysisItem}>
              <h4>{result.fileName}</h4>

              {result.error ? (
                <p className={styles.error}>{result.error}</p>
              ) : (
                <div>
                  <p>
                    <strong>Vendor:</strong> {result.vendorInfo?.name || 'Unknown'}
                    {result.identifier && <> ({result.identifier})</>}
                  </p>

                  {result.data?.transactions && (
                    <p>
                      <strong>Transactions:</strong> {result.data.transactions.length}
                    </p>
                  )}

                  {result.data?.finalBalance !== undefined && (
                    <p>
                      <strong>Final Balance:</strong> {result.data.finalBalance.toLocaleString()} ₪
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

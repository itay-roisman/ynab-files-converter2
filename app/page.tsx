'use client';

import { useEffect, useState } from 'react';

import FileUploadWithYNAB from './components/FileUploadWithYNAB';
import { analyzeFiles, FieldMapping, FileAnalysis } from './utils/fileAnalyzer';
import { YNABTransaction } from './utils/ynabService';
import styles from './page.module.css';

interface TransformedRow {
  [key: string]: string | number | null;
}

export default function Home() {
  const [isYNABConnected, setIsYNABConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const accessToken = localStorage.getItem('ynab_access_token');
    setIsYNABConnected(!!accessToken);
    setIsLoading(false);
  }, []);

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
        <FileUploadWithYNAB />
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

        <FileUploadWithYNAB />
      </div>
    </main>
  );
}

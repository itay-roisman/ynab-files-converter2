'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { YNABService } from '../utils/ynabService';
import { analyzeFiles, FileAnalysis } from '../utils/fileAnalyzer';
import styles from './FileUploadWithYNAB.module.css';

interface FileWithYNAB {
  file: File;
  budgetId: string;
  accountId: string;
  identifier?: string;
  rowCount?: number;
  vendorInfo?: {
    name: string;
    confidence: number;
    uniqueIdentifiers: string[];
  };
  transactions?: any[];
}

interface Budget {
  id: string;
  name: string;
  first_month: string;
}

interface Account {
  id: string;
  name: string;
  closed: boolean;
}

export default function FileUploadWithYNAB() {
  const [files, setFiles] = useState<FileWithYNAB[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [accounts, setAccounts] = useState<Record<string, Account[]>>({});
  const [ynabService, setYnabService] = useState<YNABService | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [expandedFile, setExpandedFile] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const accessToken = localStorage.getItem('ynab_access_token');
    if (accessToken) {
      const service = new YNABService(accessToken);
      setYnabService(service);
      service.getBudgets()
        .then(budgets => {
          setBudgets(budgets);
          // Find the primary budget (oldest one)
          const primaryBudget = budgets.reduce((oldest: Budget | null, current: Budget) => {
            if (!oldest) return current;
            return new Date(current.first_month) < new Date(oldest.first_month) ? current : oldest;
          }, null);
          
          // Load accounts for each budget
          budgets.forEach((budget: Budget) => {
            service.getAccounts(budget.id)
              .then(accounts => {
                setAccounts(prev => ({
                  ...prev,
                  [budget.id]: accounts
                }));
              });
          });

          // If we have files, update them with the primary budget
          if (files.length > 0 && primaryBudget) {
            setFiles(prev => prev.map(file => ({
              ...file,
              budgetId: file.budgetId || primaryBudget.id
            })));
          }
        });
    }
  }, [files.length]);

  const analyzeFile = async (file: File): Promise<{ identifier?: string; rowCount?: number; vendorInfo?: any; transactions?: any[] }> => {
    try {
      const analyses = await analyzeFiles([file]);
      const analysis = analyses[0];
      return {
        identifier: analysis?.identifier,
        rowCount: analysis?.data?.length,
        vendorInfo: analysis?.vendorInfo,
        transactions: analysis?.data
      };
    } catch (error) {
      console.error('Error analyzing file:', error);
      return {};
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const newFiles = Array.from(e.dataTransfer.files).filter(file => 
      file.type === 'text/csv' || 
      file.name.endsWith('.xls') || 
      file.name.endsWith('.xlsx')
    );
    
    if (newFiles.length > 0) {
      setIsAnalyzing(true);
      try {
        // Get the primary budget
        const primaryBudget = budgets.reduce((oldest: Budget | null, current: Budget) => {
          if (!oldest) return current;
          return new Date(current.first_month) < new Date(oldest.first_month) ? current : oldest;
        }, null);

        // Get stored account mappings
        const storedMappings = JSON.parse(localStorage.getItem('identifierAccountMappings') || '{}');

        // Analyze each file and create FileWithYNAB objects
        const fileWithYNABArray = await Promise.all(newFiles.map(async file => {
          const { identifier, rowCount, vendorInfo, transactions } = await analyzeFile(file);
          const accountId = identifier ? storedMappings[identifier] : '';
          
          return {
            file,
            budgetId: primaryBudget?.id || '',
            accountId,
            identifier,
            rowCount,
            vendorInfo,
            transactions
          };
        }));

        setFiles(prev => [...prev, ...fileWithYNABArray]);
      } finally {
        setIsAnalyzing(false);
      }
    }
  }, [budgets]);

  const handleSelectClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).filter(file => 
        file.type === 'text/csv' || 
        file.name.endsWith('.xls') || 
        file.name.endsWith('.xlsx')
      );
      
      if (newFiles.length > 0) {
        setIsAnalyzing(true);
        try {
          // Get the primary budget
          const primaryBudget = budgets.reduce((oldest: Budget | null, current: Budget) => {
            if (!oldest) return current;
            return new Date(current.first_month) < new Date(oldest.first_month) ? current : oldest;
          }, null);

          // Get stored account mappings
          const storedMappings = JSON.parse(localStorage.getItem('identifierAccountMappings') || '{}');

          // Analyze each file and create FileWithYNAB objects
          const fileWithYNABArray = await Promise.all(newFiles.map(async file => {
            const { identifier, rowCount, vendorInfo, transactions } = await analyzeFile(file);
            const accountId = identifier ? storedMappings[identifier] : '';
            
            return {
              file,
              budgetId: primaryBudget?.id || '',
              accountId,
              identifier,
              rowCount,
              vendorInfo,
              transactions
            };
          }));

          setFiles(prev => [...prev, ...fileWithYNABArray]);
        } finally {
          setIsAnalyzing(false);
        }
      }
    }
  }, [budgets]);

  const handleBudgetChange = (index: number, budgetId: string) => {
    setFiles(prev => {
      const newFiles = [...prev];
      newFiles[index] = {
        ...newFiles[index],
        budgetId,
        accountId: '' // Reset account when budget changes
      };
      return newFiles;
    });
  };

  const handleAccountChange = (index: number, accountId: string) => {
    setFiles(prev => {
      const newFiles = [...prev];
      newFiles[index] = {
        ...newFiles[index],
        accountId
      };
      return newFiles;
    });
  };

  const handleRemoveFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const toggleFileExpansion = (index: number) => {
    setExpandedFile(expandedFile === index ? null : index);
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleSendToYNAB = async () => {
    if (!ynabService) {
      setError('YNAB service is not initialized');
      return;
    }

    // Validate all files have budget and account selected
    const invalidFiles = files.filter(file => !file.budgetId || !file.accountId);
    if (invalidFiles.length > 0) {
      setError('Please select a budget and account for all files');
      return;
    }

    setIsSending(true);
    setError(null);
    setSuccess(null);

    try {
      // Group transactions by budget
      const transactionsByBudget: Record<string, any[]> = {};
      
      files.forEach(file => {
        if (file.transactions && file.budgetId && file.accountId) {
          const transactionsWithAccount = file.transactions.map(t => ({
            ...t,
            account_id: file.accountId
          }));

          if (!transactionsByBudget[file.budgetId]) {
            transactionsByBudget[file.budgetId] = [];
          }
          transactionsByBudget[file.budgetId].push(...transactionsWithAccount);
        }
      });

      // Send transactions for each budget
      await Promise.all(
        Object.entries(transactionsByBudget).map(([budgetId, transactions]) =>
          ynabService.createTransactions(budgetId, transactions)
        )
      );

      // Store account mappings for future use
      const storedMappings = JSON.parse(localStorage.getItem('identifierAccountMappings') || '{}');
      files.forEach(file => {
        if (file.identifier && file.accountId) {
          storedMappings[file.identifier] = file.accountId;
        }
      });
      localStorage.setItem('identifierAccountMappings', JSON.stringify(storedMappings));

      setSuccess('Transactions successfully sent to YNAB!');
      setFiles([]); // Clear the files after successful send
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to send transactions to YNAB');
    } finally {
      setIsSending(false);
    }
  };

  const canSendToYNAB = files.length > 0 && files.every(file => file.budgetId && file.accountId);

  return (
    <div className={styles.container}>
      <div 
        className={`${styles.uploadArea} ${isDragging ? styles.dragging : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          id="fileInput"
          className={styles.fileInput}
          accept=".csv,.xls,.xlsx"
          multiple
          onChange={handleFileSelect}
        />
        <div className={styles.uploadContent}>
          <div className={styles.uploadIcon}>📁</div>
          <div className={styles.uploadText}>
            <p>Drag and drop your files here</p>
            <p>or</p>
            <button 
              type="button"
              className={styles.selectButton}
              onClick={handleSelectClick}
            >
              Select Files
            </button>
          </div>
          <p className={styles.supportedFormats}>Supported formats: CSV, XLS, XLSX</p>
        </div>
      </div>

      {isAnalyzing && (
        <div className={styles.analyzing}>
          <p>Analyzing files...</p>
        </div>
      )}

      {error && (
        <div className={styles.error}>
          <p>{error}</p>
        </div>
      )}

      {success && (
        <div className={styles.success}>
          <p>{success}</p>
        </div>
      )}

      {files.length > 0 && (
        <div className={styles.filesList}>
          <h3>Uploaded Files</h3>
          <div className={styles.filesTable}>
            <div className={styles.tableHeader}>
              <div className={styles.fileName}>File Name</div>
              <div className={styles.fileInfo}>Info</div>
              <div className={styles.budgetSelect}>Budget</div>
              <div className={styles.accountSelect}>Account</div>
              <div className={styles.actions}>Actions</div>
            </div>
            {files.map((fileWithYNAB, index) => (
              <div key={index} className={styles.fileRow}>
                <div className={styles.fileName}>{fileWithYNAB.file.name}</div>
                <div className={styles.fileInfo}>
                  {fileWithYNAB.identifier && (
                    <div className={styles.infoIcon}>
                      <span className={styles.identifier}>{fileWithYNAB.identifier}</span>
                      <button 
                        className={styles.expandButton}
                        onClick={() => toggleFileExpansion(index)}
                      >
                        {expandedFile === index ? '▼' : '▶'}
                      </button>
                    </div>
                  )}
                </div>
                <div className={styles.budgetSelect}>
                  <select
                    value={fileWithYNAB.budgetId}
                    onChange={(e) => handleBudgetChange(index, e.target.value)}
                  >
                    <option value="">Select Budget</option>
                    {budgets.map(budget => (
                      <option key={budget.id} value={budget.id}>
                        {budget.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.accountSelect}>
                  <select
                    value={fileWithYNAB.accountId}
                    onChange={(e) => handleAccountChange(index, e.target.value)}
                    disabled={!fileWithYNAB.budgetId}
                  >
                    <option value="">Select Account</option>
                    {fileWithYNAB.budgetId && accounts[fileWithYNAB.budgetId]?.map(account => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.actions}>
                  <button
                    className={styles.removeButton}
                    onClick={() => handleRemoveFile(index)}
                  >
                    Remove
                  </button>
                </div>
                {expandedFile === index && fileWithYNAB.transactions && (
                  <div className={styles.transactionsTable}>
                    <div className={styles.transactionsHeader}>
                      <div className={styles.transactionDate}>Date</div>
                      <div className={styles.transactionPayee}>Payee</div>
                      <div className={styles.transactionAmount}>Amount</div>
                      <div className={styles.transactionMemo}>Memo</div>
                    </div>
                    {fileWithYNAB.transactions.map((transaction, tIndex) => (
                      <div key={tIndex} className={styles.transactionRow}>
                        <div className={styles.transactionDate}>
                          {formatDate(transaction.date)}
                        </div>
                        <div className={styles.transactionPayee}>
                          {transaction.payee_name}
                        </div>
                        <div className={`${styles.transactionAmount} ${transaction.amount < 0 ? styles.negative : ''}`}>
                          {formatAmount(transaction.amount)}
                        </div>
                        <div className={styles.transactionMemo}>
                          {transaction.memo}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className={styles.sendToYNAB}>
            <button
              className={styles.sendButton}
              onClick={handleSendToYNAB}
              disabled={!canSendToYNAB || isSending}
            >
              {isSending ? 'Sending...' : 'Send to YNAB'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
} 
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { analyzeFiles } from '../analyzers/fileAnalyzer';
import { YNAB_OAUTH_CONFIG } from '../config/oauth';
import { disconnectFromYNAB, YNABService } from '../utils/ynabService';
import AccountBalancesReport from './AccountBalancesReport';
import styles from './FileUploadWithYNAB.module.css';
import { filterSupportedFiles, processFiles } from './FileUploadWithYNAB.utils';
import UploadedFilesTable from './UploadedFilesTable';

interface FileWithYNAB {
  file: File;
  budgetId: string;
  accountId: string;
  identifier?: string | null;
  rowCount?: number;
  vendorInfo?: {
    name: string;
    confidence: number;
    uniqueIdentifiers: string[];
  };
  transactions?: any[];
  finalBalance?: number;
}

interface Budget {
  id: string;
  name: string;
  first_month: string;
  currency_format: {
    currency_symbol: string;
    decimal_digits: number;
    decimal_separator: string;
    display_symbol: boolean;
    example_format: string;
    group_separator: string;
    iso_code: string;
    symbol_first: boolean;
  };
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
  const [accountBalances, setAccountBalances] = useState<Record<string, any[]>>({});
  const [submissionComplete, setSubmissionComplete] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Initialize access token from localStorage
  useEffect(() => {
    const token = localStorage.getItem('ynab_access_token');
    setAccessToken(token);
  }, []);

  const handleConnect = () => {
    const authUrl = new URL(YNAB_OAUTH_CONFIG.authUrl);
    authUrl.searchParams.append('client_id', YNAB_OAUTH_CONFIG.clientId);
    authUrl.searchParams.append('redirect_uri', YNAB_OAUTH_CONFIG.redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', YNAB_OAUTH_CONFIG.scope);

    window.location.href = authUrl.toString();
  };

  const handleDisconnect = () => {
    disconnectFromYNAB();
    setYnabService(null);
    setBudgets([]);
    setAccounts({});
    setAccessToken(null);
  };

  useEffect(() => {
    if (accessToken) {
      const service = new YNABService(accessToken);
      setYnabService(service);
      service.getBudgets().then((budgets) => {
        setBudgets(budgets);
        // Find the primary budget (oldest one)
        const primaryBudget = budgets.reduce((oldest: Budget | null, current: Budget) => {
          if (!oldest) return current;
          return new Date(current.first_month) < new Date(oldest.first_month) ? current : oldest;
        }, null);

        // Load accounts for each budget
        budgets.forEach((budget: Budget) => {
          service.getAccounts(budget.id).then((accounts) => {
            setAccounts((prev) => ({
              ...prev,
              [budget.id]: accounts,
            }));
          });
        });

        // If we have files, update them with the primary budget
        if (files.length > 0 && primaryBudget) {
          setFiles((prev) =>
            prev.map((file) => ({
              ...file,
              budgetId: file.budgetId || primaryBudget.id,
            }))
          );
        }
      });
    }
  }, [files.length, accessToken]);

  const analyzeFile = async (
    file: File
  ): Promise<{
    identifier?: string;
    rowCount?: number;
    vendorInfo?: any;
    transactions?: any[];
    finalBalance?: number;
  }> => {
    try {
      const analyses = await analyzeFiles([file]);
      const analysis = analyses[0];
      const finalBalance = analysis?.finalBalance || analysis?.data?.finalBalance;

      console.log('File analysis result:', {
        fileName: file.name,
        vendorInfo: analysis?.vendorInfo?.name,
        finalBalanceFromTopLevel: analysis?.finalBalance,
        finalBalanceFromData: analysis?.data?.finalBalance,
        finalBalanceUsed: finalBalance,
      });

      return {
        identifier: analysis?.identifier ?? undefined,
        rowCount: analysis?.data?.transactions?.length,
        vendorInfo: analysis?.vendorInfo,
        transactions: analysis?.data?.transactions,
        finalBalance: finalBalance,
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

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const newFiles = filterSupportedFiles(Array.from(e.dataTransfer.files));

      if (newFiles.length > 0) {
        const fileWithYNABArray = await processFiles(
          newFiles,
          budgets,
          analyzeFile,
          setIsAnalyzing,
          setSubmissionComplete,
          setSuccess,
          setAccountBalances
        );

        setFiles((prev) => [...prev, ...fileWithYNABArray]);
      }
    },
    [budgets]
  );

  const handleSelectClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const newFiles = filterSupportedFiles(Array.from(e.target.files));

        if (newFiles.length > 0) {
          const fileWithYNABArray = await processFiles(
            newFiles,
            budgets,
            analyzeFile,
            setIsAnalyzing,
            setSubmissionComplete,
            setSuccess,
            setAccountBalances
          );

          setFiles((prev) => [...prev, ...fileWithYNABArray]);
        }
      }
    },
    [budgets]
  );

  const handleBudgetChange = (index: number, budgetId: string) => {
    setFiles((prev) => {
      const newFiles = [...prev];
      newFiles[index] = {
        ...newFiles[index],
        budgetId,
        accountId: '', // Reset account when budget changes
      };
      return newFiles;
    });
  };

  const handleAccountChange = (index: number, accountId: string) => {
    setFiles((prev) => {
      const newFiles = [...prev];
      newFiles[index] = {
        ...newFiles[index],
        accountId,
      };
      return newFiles;
    });
  };

  const handleRemoveFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleFileExpansion = (index: number) => {
    setExpandedFile(expandedFile === index ? null : index);
  };

  const handleSendToYNAB = async () => {
    if (!ynabService) {
      setError('YNAB service is not initialized');
      return;
    }

    // Validate all files have budget and account selected
    const invalidFiles = files.filter((file) => !file.budgetId || !file.accountId);
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
      const usedAccounts: Record<
        string,
        { budgetId: string; accountId: string; fileName: string; finalBalance?: number }
      > = {};

      files.forEach((file) => {
        if (file.transactions && file.budgetId && file.accountId) {
          const transactionsWithAccount = file.transactions.map((t) => ({
            ...t,
            account_id: file.accountId,
          }));

          if (!transactionsByBudget[file.budgetId]) {
            transactionsByBudget[file.budgetId] = [];
          }
          transactionsByBudget[file.budgetId].push(...transactionsWithAccount);

          // Track unique accounts used for later balance fetching
          const key = `${file.budgetId}_${file.accountId}`;
          if (!usedAccounts[key]) {
            usedAccounts[key] = {
              budgetId: file.budgetId,
              accountId: file.accountId,
              fileName: file.file.name,
              finalBalance: file.finalBalance,
            };
          }
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
      files.forEach((file) => {
        if (file.identifier && file.accountId) {
          storedMappings[file.identifier] = file.accountId;
        }
      });
      localStorage.setItem('identifierAccountMappings', JSON.stringify(storedMappings));

      // Fetch updated account balances
      const accountBalancesResult: Record<string, any[]> = {};

      await Promise.all(
        Object.values(usedAccounts).map(async ({ budgetId, accountId, fileName, finalBalance }) => {
          try {
            const accountDetails = await ynabService.getAccountDetails(budgetId, accountId);
            if (!accountBalancesResult[budgetId]) {
              accountBalancesResult[budgetId] = [];
            }

            // Add file information to account details for reconciliation
            accountBalancesResult[budgetId].push({
              ...accountDetails,
              fileName,
              fileBalance: finalBalance,
            });
          } catch (error) {
            console.error(
              `Error fetching balance for account ${accountId} in budget ${budgetId}:`,
              error
            );
          }
        })
      );

      setAccountBalances(accountBalancesResult);
      setSubmissionComplete(true);
      setSuccess('Transactions successfully sent to YNAB!');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to send transactions to YNAB');
    } finally {
      setIsSending(false);
    }
  };

  const canSendToYNAB =
    files.length > 0 &&
    files.every((file) => file.budgetId && file.accountId) &&
    !submissionComplete;

  // Render unauthorized UI if no access token
  if (!accessToken) {
    return (
      <div className={styles.container}>
        <div className={styles.unauthorizedContainer}>
          <h3>Connect to YNAB</h3>
          <p className={styles.unauthorizedMessage}>
            You need to authorize this application to access your YNAB account. This will allow you
            to send transactions directly to your YNAB budget.
          </p>
          <button className={styles.connectButton} onClick={handleConnect}>
            Authorize with YNAB
          </button>
        </div>
      </div>
    );
  }

  // Render authorized UI
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>YNAB Integration</h3>
        <button className={styles.disconnectButton} onClick={handleDisconnect}>
          Disconnect from YNAB
        </button>
      </div>
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
          accept=".csv,.xls,.xlsx,.xlsm"
          multiple
          onChange={handleFileSelect}
        />
        <div className={styles.uploadContent}>
          <div className={styles.uploadIcon}>📁</div>
          <div className={styles.uploadText}>
            <p>Drag and drop your files here</p>
            <p>or</p>
            <button type="button" className={styles.selectButton} onClick={handleSelectClick}>
              Select Files
            </button>
          </div>
          <p className={styles.supportedFormats}>Supported formats: CSV, XLS, XLSX, XLSM</p>
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

      {submissionComplete && Object.keys(accountBalances).length > 0 && (
        <AccountBalancesReport accountBalances={accountBalances} budgets={budgets} />
      )}

      {files.length > 0 && (
        <UploadedFilesTable
          files={files}
          budgets={budgets}
          accounts={accounts}
          expandedFile={expandedFile}
          onBudgetChange={handleBudgetChange}
          onAccountChange={handleAccountChange}
          onRemoveFile={handleRemoveFile}
          onToggleExpansion={toggleFileExpansion}
          onSendToYNAB={handleSendToYNAB}
          isSending={isSending}
          canSendToYNAB={canSendToYNAB}
        />
      )}
    </div>
  );
}

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { YNABService } from '../utils/ynabService';
import { analyzeFiles, FileAnalysis } from '../utils/fileAnalyzer';
import { YNAB_OAUTH_CONFIG } from '../config/oauth';
import styles from './FileUploadWithYNAB.module.css';

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
    localStorage.removeItem('ynab_access_token');
    localStorage.removeItem('ynab_refresh_token');
    localStorage.removeItem('ynab_token_expiry');
    setYnabService(null);
    setBudgets([]);
    setAccounts({});
    setAccessToken(null);
  };

  useEffect(() => {
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
  }, [files.length, accessToken]);

  const analyzeFile = async (file: File): Promise<{ identifier?: string; rowCount?: number; vendorInfo?: any; transactions?: any[]; finalBalance?: number }> => {
    try {
      const analyses = await analyzeFiles([file]);
      const analysis = analyses[0];
      const finalBalance = analysis?.finalBalance || analysis?.data?.finalBalance;
      
      console.log('File analysis result:', {
        fileName: file.name,
        vendorInfo: analysis?.vendorInfo?.name,
        finalBalanceFromTopLevel: analysis?.finalBalance,
        finalBalanceFromData: analysis?.data?.finalBalance,
        finalBalanceUsed: finalBalance
      });
      
      return {
        identifier: analysis?.identifier,
        rowCount: analysis?.data?.transactions?.length,
        vendorInfo: analysis?.vendorInfo,
        transactions: analysis?.data?.transactions,
        finalBalance: finalBalance
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
      file.name.endsWith('.xlsx') ||
      file.name.endsWith('.xlsm')
    );
    
    if (newFiles.length > 0) {
      // Reset submission status when new files are uploaded
      setSubmissionComplete(false);
      setSuccess(null);
      setAccountBalances({});
      
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
          const { identifier, rowCount, vendorInfo, transactions, finalBalance } = await analyzeFile(file);
          const accountId = identifier ? storedMappings[identifier] : '';
          
          return {
            file,
            budgetId: primaryBudget?.id || '',
            accountId,
            identifier,
            rowCount,
            vendorInfo,
            transactions,
            finalBalance
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
        file.name.endsWith('.xlsx') ||
        file.name.endsWith('.xlsm')
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
            const { identifier, rowCount, vendorInfo, transactions, finalBalance } = await analyzeFile(file);
            const accountId = identifier ? storedMappings[identifier] : '';
            
            return {
              file,
              budgetId: primaryBudget?.id || '',
              accountId,
              identifier,
              rowCount,
              vendorInfo,
              transactions,
              finalBalance
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

  const formatAmount = (amount: number, budgetId: string) => {
    const budget = budgets.find(b => b.id === budgetId);
    if (!budget) return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'narrowSymbol'
    }).format(amount / 1000).replace('$', '') + ' $';

    const { currency_format } = budget;
    const formatter = new Intl.NumberFormat(currency_format.iso_code, {
      style: 'currency',
      currency: currency_format.iso_code,
      minimumFractionDigits: currency_format.decimal_digits,
      maximumFractionDigits: currency_format.decimal_digits,
      currencyDisplay: 'narrowSymbol'
    });

    // Remove the currency symbol from the beginning and add it to the end
    const formattedAmount = formatter.format(amount / 1000);
    const currencySymbol = currency_format.currency_symbol;
    return formattedAmount.replace(currencySymbol, '').trim() + ' ' + currencySymbol;
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
      const usedAccounts: Record<string, { budgetId: string, accountId: string, fileName: string, finalBalance?: number }> = {};
      
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
          
          // Track unique accounts used for later balance fetching
          const key = `${file.budgetId}_${file.accountId}`;
          if (!usedAccounts[key]) {
            usedAccounts[key] = {
              budgetId: file.budgetId,
              accountId: file.accountId,
              fileName: file.file.name,
              finalBalance: file.finalBalance
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
      files.forEach(file => {
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
              fileBalance: finalBalance
            });
          } catch (error) {
            console.error(`Error fetching balance for account ${accountId} in budget ${budgetId}:`, error);
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

  const canSendToYNAB = files.length > 0 && files.every(file => file.budgetId && file.accountId) && !submissionComplete;

  // Render unauthorized UI if no access token
  if (!accessToken) {
    return (
      <div className={styles.container}>
        <div className={styles.unauthorizedContainer}>
          <h3>Connect to YNAB</h3>
          <p className={styles.unauthorizedMessage}>
            You need to authorize this application to access your YNAB account.
            This will allow you to send transactions directly to your YNAB budget.
          </p>
          <button
            className={styles.connectButton}
            onClick={handleConnect}
          >
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
        <button
          className={styles.disconnectButton}
          onClick={handleDisconnect}
        >
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
            <button 
              type="button"
              className={styles.selectButton}
              onClick={handleSelectClick}
            >
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
        <div className={styles.accountBalancesReport}>
          <h3>Account Balances Report</h3>
          <div className={styles.balancesList}>
            {Object.entries(accountBalances).map(([budgetId, accounts]) => {
              const budget = budgets.find(b => b.id === budgetId);
              return (
                <div key={budgetId} className={styles.budgetBalances}>
                  <h4>{budget?.name || 'Budget'}</h4>
                  <div className={styles.accountsTable}>
                    <div className={styles.accountsHeader}>
                      <div className={styles.accountName}>Account</div>
                      <div className={styles.accountBalance}>Current Balance</div>
                      <div className={styles.accountCleared}>Cleared Balance</div>
                      <div className={styles.fileBalance}>File Balance</div>
                      <div className={styles.reconcileDiff}>Difference</div>
                    </div>
                    {accounts.map(account => {
                      const fileBalance = account.fileBalance !== undefined ? account.fileBalance * 1000 : null;
                      const difference = fileBalance !== null ? fileBalance - account.cleared_balance : null;
                      const hasDifference = difference !== null && Math.abs(difference) > 0;
                      
                      return (
                        <div key={account.id} className={styles.accountRow}>
                          <div className={styles.accountName}>
                            {account.name}
                            <div className={styles.fileName}>
                              <small>File: {account.fileName}</small>
                            </div>
                          </div>
                          <div className={`${styles.accountBalance} ${account.balance < 0 ? styles.negative : ''}`}>
                            {formatAmount(account.balance, budgetId)}
                          </div>
                          <div className={`${styles.accountCleared} ${account.cleared_balance < 0 ? styles.negative : ''}`}>
                            {formatAmount(account.cleared_balance, budgetId)}
                          </div>
                          <div className={styles.fileBalance}>
                            {account.fileBalance !== undefined 
                              ? formatAmount(account.fileBalance * 1000, budgetId)
                              : 'N/A'}
                          </div>
                          <div className={`${styles.reconcileDiff} ${hasDifference ? (difference < 0 ? styles.negative : styles.positive) : ''}`}>
                            {difference !== null 
                              ? `${hasDifference ? (difference < 0 ? '-' : '+') : ''} ${formatAmount(Math.abs(difference), budgetId)}`
                              : 'N/A'}
                            {hasDifference && 
                              <div className={styles.reconcileNote}>
                                <small>{difference < 0 ? 'Missing transactions in YNAB' : 'Extra transactions in YNAB'}</small>
                              </div>
                            }
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
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
              <div className={styles.balance}>Balance</div>
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
                <div className={styles.balance}>
                  {(fileWithYNAB.vendorInfo?.name === 'Bank Hapoalim' || fileWithYNAB.vendorInfo?.name === 'Isracard' || fileWithYNAB.vendorInfo?.name === 'Max') && fileWithYNAB.finalBalance && (
                    <span className={styles.balanceAmount}>
                      ₪{fileWithYNAB.finalBalance.toLocaleString()}
                    </span>
                  )}
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
                    {[...fileWithYNAB.transactions]
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .map((transaction, tIndex) => (
                      <div key={tIndex} className={styles.transactionRow}>
                        <div className={styles.transactionDate}>
                          {formatDate(transaction.date)}
                        </div>
                        <div className={styles.transactionPayee}>
                          {transaction.payee_name}
                        </div>
                        <div className={`${styles.transactionAmount} ${transaction.amount < 0 ? styles.negative : ''}`}>
                          {formatAmount(transaction.amount, fileWithYNAB.budgetId)}
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
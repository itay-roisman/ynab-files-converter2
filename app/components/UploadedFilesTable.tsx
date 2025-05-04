'use client';

import React from 'react';

import TransactionsList from './TransactionsList';
import styles from './UploadedFilesTable.module.css';

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

interface UploadedFilesTableProps {
  files: FileWithYNAB[];
  budgets: Budget[];
  accounts: Record<string, Account[]>;
  expandedFile: number | null;
  onBudgetChange: (index: number, budgetId: string) => void;
  onAccountChange: (index: number, accountId: string) => void;
  onRemoveFile: (index: number) => void;
  onToggleExpansion: (index: number) => void;
  onSendToYNAB: () => void;
  isSending: boolean;
  canSendToYNAB: boolean;
}

const UploadedFilesTable: React.FC<UploadedFilesTableProps> = ({
  files,
  budgets,
  accounts,
  expandedFile,
  onBudgetChange,
  onAccountChange,
  onRemoveFile,
  onToggleExpansion,
  onSendToYNAB,
  isSending,
  canSendToYNAB,
}) => {
  return (
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
                  <button className={styles.expandButton} onClick={() => onToggleExpansion(index)}>
                    {expandedFile === index ? '▼' : '▶'}
                  </button>
                </div>
              )}
            </div>
            <div className={styles.budgetSelect}>
              <select
                value={fileWithYNAB.budgetId}
                onChange={(e) => onBudgetChange(index, e.target.value)}
              >
                <option value="">Select Budget</option>
                {budgets.map((budget) => (
                  <option key={budget.id} value={budget.id}>
                    {budget.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.accountSelect}>
              <select
                value={fileWithYNAB.accountId}
                onChange={(e) => onAccountChange(index, e.target.value)}
                disabled={!fileWithYNAB.budgetId}
              >
                <option value="">Select Account</option>
                {fileWithYNAB.budgetId &&
                  accounts[fileWithYNAB.budgetId]?.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className={styles.balance}>
              {fileWithYNAB.finalBalance !== undefined && fileWithYNAB.finalBalance !== null && (
                <span className={styles.balanceAmount}>
                  ₪{fileWithYNAB.finalBalance.toLocaleString()}
                </span>
              )}
            </div>
            <div className={styles.actions}>
              <button className={styles.removeButton} onClick={() => onRemoveFile(index)}>
                Remove
              </button>
            </div>
            {expandedFile === index && fileWithYNAB.transactions && (
              <TransactionsList
                transactions={fileWithYNAB.transactions}
                budgetId={fileWithYNAB.budgetId}
                budgets={budgets}
              />
            )}
          </div>
        ))}
      </div>
      <div className={styles.sendToYNAB}>
        <button
          className={styles.sendButton}
          onClick={onSendToYNAB}
          disabled={!canSendToYNAB || isSending}
        >
          {isSending ? 'Sending...' : 'Send to YNAB'}
        </button>
      </div>
    </div>
  );
};

export default UploadedFilesTable;

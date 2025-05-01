import React from 'react';

import { formatAmount, formatDate } from './FileUploadWithYNAB.utils';
import styles from './TransactionsList.module.css';

interface Transaction {
  date: string;
  payee_name: string;
  amount: number;
  memo: string;
}

interface TransactionsListProps {
  transactions: Transaction[];
  budgetId: string;
  budgets: any[];
}

const TransactionsList: React.FC<TransactionsListProps> = ({ transactions, budgetId, budgets }) => {
  return (
    <div className={styles.transactionsTable}>
      <div className={styles.transactionsHeader}>
        <div className={styles.transactionDate}>Date</div>
        <div className={styles.transactionPayee}>Payee</div>
        <div className={styles.transactionAmount}>Amount</div>
        <div className={styles.transactionMemo}>Memo</div>
      </div>
      {[...transactions]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map((transaction, tIndex) => (
          <div key={tIndex} className={styles.transactionRow}>
            <div className={styles.transactionDate}>{formatDate(transaction.date)}</div>
            <div className={styles.transactionPayee}>{transaction.payee_name}</div>
            <div
              className={`${styles.transactionAmount} ${transaction.amount < 0 ? styles.negative : ''}`}
            >
              {formatAmount(transaction.amount, budgetId, budgets)}
            </div>
            <div className={styles.transactionMemo}>{transaction.memo}</div>
          </div>
        ))}
    </div>
  );
};

export default TransactionsList;

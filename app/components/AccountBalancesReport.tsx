import React from 'react';

import styles from './AccountBalancesReport.module.css';
import { formatAmount } from './FileUploadWithYNAB.utils';

interface Account {
  id: string;
  name: string;
  balance: number;
  cleared_balance: number;
  fileName: string;
  fileBalance?: number;
}

interface Budget {
  id: string;
  name: string;
}

interface AccountBalancesReportProps {
  accountBalances: Record<string, Account[]>;
  budgets: Budget[];
}

const AccountBalancesReport: React.FC<AccountBalancesReportProps> = ({
  accountBalances,
  budgets,
}) => {
  if (Object.keys(accountBalances).length === 0) {
    return null;
  }

  return (
    <div className={styles.accountBalancesReport}>
      <h3>Account Balances Report</h3>
      <div className={styles.balancesList}>
        {Object.entries(accountBalances).map(([budgetId, accounts]) => {
          const budget = budgets.find((b) => b.id === budgetId);
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
                {accounts.map((account) => {
                  // Don't multiply fileBalance by 1000 since it's already in milliunits from the analyzer
                  const fileBalance =
                    account.fileBalance !== undefined ? account.fileBalance : null;
                  const difference =
                    fileBalance !== null ? fileBalance - account.cleared_balance : null;
                  const hasDifference = difference !== null && Math.abs(difference) > 0;

                  return (
                    <div key={account.id} className={styles.accountRow}>
                      <div className={styles.accountName}>
                        {account.name}
                        <div className={styles.fileName}>
                          <small>File: {account.fileName}</small>
                        </div>
                      </div>
                      <div
                        className={`${styles.accountBalance} ${account.balance < 0 ? styles.negative : ''}`}
                      >
                        {formatAmount(account.balance, budgetId, budgets)}
                      </div>
                      <div
                        className={`${styles.accountCleared} ${account.cleared_balance < 0 ? styles.negative : ''}`}
                      >
                        {formatAmount(account.cleared_balance, budgetId, budgets)}
                      </div>
                      <div className={styles.fileBalance}>
                        {account.fileBalance !== undefined
                          ? formatAmount(account.fileBalance, budgetId, budgets)
                          : 'N/A'}
                      </div>
                      <div
                        className={`${styles.reconcileDiff} ${hasDifference ? (difference < 0 ? styles.negative : styles.positive) : ''}`}
                      >
                        {difference !== null
                          ? `${hasDifference ? (difference < 0 ? '-' : '+') : ''} ${formatAmount(Math.abs(difference), budgetId, budgets)}`
                          : 'N/A'}
                        {hasDifference && (
                          <div className={styles.reconcileNote}>
                            <small>
                              {difference < 0
                                ? 'Missing transactions in YNAB'
                                : 'Extra transactions in YNAB'}
                            </small>
                          </div>
                        )}
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
  );
};

export default AccountBalancesReport;

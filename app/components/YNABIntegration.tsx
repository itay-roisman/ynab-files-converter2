'use client';

import { useEffect, useState } from 'react';

import { YNAB_OAUTH_CONFIG } from '../config/oauth';
import { YNABService, YNABTransaction } from '../utils/ynabService';
import styles from './YNABIntegration.module.css';

interface YNABIntegrationProps {
  transactions?: YNABTransaction[];
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  identifier?: string;
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

export default function YNABIntegration({
  transactions = [],
  onSuccess,
  onError,
  identifier,
}: YNABIntegrationProps) {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedBudget, setSelectedBudget] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [ynabService, setYnabService] = useState<YNABService | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Initialize access token from localStorage
  useEffect(() => {
    const token = localStorage.getItem('ynab_access_token');
    setAccessToken(token);
    console.log('Access token status:', { hasAccessToken: !!token });
  }, []);

  useEffect(() => {
    const refreshToken = localStorage.getItem('ynab_refresh_token');

    if (accessToken) {
      const service = new YNABService(accessToken, refreshToken || undefined);
      setYnabService(service);
      service
        .getBudgets()
        .then((budgets) => {
          setBudgets(budgets);
          // Find the primary budget (oldest one)
          const primaryBudget = budgets.reduce((oldest: Budget | null, current: Budget) => {
            if (!oldest) return current;
            return new Date(current.first_month) < new Date(oldest.first_month) ? current : oldest;
          }, null);
          if (primaryBudget) {
            setSelectedBudget(primaryBudget.id);
          }
        })
        .catch((error) => {
          if (error.message === 'Authentication failed. Please reconnect to YNAB.') {
            // Clear tokens and show connect button
            localStorage.removeItem('ynab_access_token');
            localStorage.removeItem('ynab_refresh_token');
            localStorage.removeItem('ynab_token_expiry');
            setYnabService(null);
            setAccessToken(null);
          }
          onError?.(error);
        });
    }
  }, [accessToken, onError]);

  useEffect(() => {
    if (selectedBudget && ynabService) {
      ynabService
        .getAccounts(selectedBudget)
        .then(setAccounts)
        .catch((error) => {
          if (error.message === 'Authentication failed. Please reconnect to YNAB.') {
            // Clear tokens and show connect button
            localStorage.removeItem('ynab_access_token');
            localStorage.removeItem('ynab_refresh_token');
            localStorage.removeItem('ynab_token_expiry');
            setYnabService(null);
            setAccessToken(null);
          }
          onError?.(error);
        });
    }
  }, [selectedBudget, ynabService, onError]);

  useEffect(() => {
    if (identifier) {
      // Try to get the previously selected account for this identifier
      const storedMappings = JSON.parse(localStorage.getItem('identifierAccountMappings') || '{}');
      const storedAccountId = storedMappings[identifier];
      if (storedAccountId) {
        setSelectedAccount(storedAccountId);
      }
    }
  }, [identifier]);

  const handleSubmit = async () => {
    if (!ynabService || !selectedBudget || !selectedAccount) {
      onError?.(new Error('Please select a budget and account'));
      return;
    }

    setIsLoading(true);
    try {
      const transactionsWithAccount = transactions.map((t) => ({
        ...t,
        account_id: selectedAccount,
      }));
      await ynabService.createTransactions(selectedBudget, transactionsWithAccount);

      // Store the identifier-account mapping
      if (identifier) {
        const storedMappings = JSON.parse(
          localStorage.getItem('identifierAccountMappings') || '{}'
        );
        storedMappings[identifier] = selectedAccount;
        localStorage.setItem('identifierAccountMappings', JSON.stringify(storedMappings));
      }

      onSuccess?.();
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error('Failed to create transactions'));
    } finally {
      setIsLoading(false);
    }
  };

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
    setAccessToken(null);
  };

  return (
    <div className={styles.container}>
      {!accessToken ? (
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
      ) : (
        <>
          <h3>Send to YNAB</h3>

          <div className={styles.formGroup}>
            <label htmlFor="budget">Select Budget:</label>
            <select
              id="budget"
              value={selectedBudget}
              onChange={(e) => setSelectedBudget(e.target.value)}
              disabled={isLoading}
            >
              <option value="">Select a budget</option>
              {budgets.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="account">Select Account:</label>
            <select
              id="account"
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              disabled={!selectedBudget || isLoading}
            >
              <option value="">Select an account</option>
              {accounts
                .filter((account) => !account.closed)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
          </div>

          <button
            className={styles.submitButton}
            onClick={handleSubmit}
            disabled={!selectedAccount || isLoading}
          >
            {isLoading ? 'Sending...' : 'Send to YNAB'}
          </button>

          <button className={styles.disconnectButton} onClick={handleDisconnect}>
            Disconnect from YNAB
          </button>
        </>
      )}
    </div>
  );
}

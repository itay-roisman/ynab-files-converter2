'use client';

import { useEffect, useState } from 'react';

import { YNAB_OAUTH_CONFIG } from '../config/oauth';
import { YNABService, YNABTransaction, disconnectFromYNAB } from '../utils/ynabService';
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

      // Fetch budgets
      service
        .getBudgets()
        .then((data) => {
          setBudgets(data);
        })
        .catch((error) => {
          console.error('Failed to fetch budgets:', error);
          // Handle authentication errors by disconnecting
          if (error.message.includes('Authentication failed')) {
            handleDisconnect();
          }
        });
    }
  }, [accessToken]);

  // When budget is selected, fetch accounts
  useEffect(() => {
    if (ynabService && selectedBudget) {
      ynabService
        .getAccounts(selectedBudget)
        .then((data) => {
          // Filter out closed accounts
          const activeAccounts = data.filter((account: Account) => !account.closed);
          setAccounts(activeAccounts);
        })
        .catch((error) => {
          console.error('Failed to fetch accounts:', error);
          // Handle authentication errors by disconnecting
          if (error.message.includes('Authentication failed')) {
            handleDisconnect();
          }
        });
    } else {
      setAccounts([]);
    }
  }, [ynabService, selectedBudget]);

  // Load account mapping from localStorage if available
  useEffect(() => {
    if (identifier && accounts.length > 0) {
      const storedMappings = JSON.parse(localStorage.getItem('identifierAccountMappings') || '{}');
      const storedAccountId = storedMappings[identifier];
      if (storedAccountId) {
        setSelectedAccount(storedAccountId);
      }
    }
  }, [identifier, accounts]);

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
      console.error('Error creating transactions:', error);
      // Handle authentication errors by disconnecting
      if (error instanceof Error && error.message.includes('Authentication failed')) {
        handleDisconnect();
      }
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
    disconnectFromYNAB();
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
              disabled={isLoading || !selectedBudget}
            >
              <option value="">Select an account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.actionsContainer}>
            <button
              className={styles.submitButton}
              onClick={handleSubmit}
              disabled={isLoading || !selectedBudget || !selectedAccount}
            >
              {isLoading ? 'Sending...' : 'Send to YNAB'}
            </button>
            <button className={styles.disconnectButton} onClick={handleDisconnect}>
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}

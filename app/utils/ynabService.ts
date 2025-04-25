const YNAB_API_BASE = 'https://api.ynab.com/v1';

export interface YNABTransaction {
  date: string;
  payee_name: string;
  memo?: string;
  amount: number;
  cleared: 'cleared' | 'uncleared' | 'reconciled';
  account_id: string;
  approved: boolean;
}

export const YNAB_OAUTH_CONFIG = {
  authUrl: 'https://app.ynab.com/oauth/authorize',
  tokenUrl: 'https://app.ynab.com/oauth/token',
  clientId: process.env.NEXT_PUBLIC_YNAB_CLIENT_ID || '',
  clientSecret: process.env.YNAB_CLIENT_SECRET || '',
  redirectUri: process.env.NEXT_PUBLIC_YNAB_REDIRECT_URI || '',
  scope: 'read-only write-transactions',
};

export class YNABService {
  private accessToken: string;
  private refreshToken: string | null;
  private tokenExpiry: number | null;

  constructor(accessToken: string, refreshToken?: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken || null;
    this.tokenExpiry = null;
  }

  private async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await fetch('/api/oauth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refresh_token: this.refreshToken,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to refresh token');
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000);
      
      // Store the new tokens
      localStorage.setItem('ynab_access_token', this.accessToken);
      localStorage.setItem('ynab_refresh_token', this.refreshToken);
      localStorage.setItem('ynab_token_expiry', this.tokenExpiry.toString());
      
      return true;
    } catch (error) {
      console.error('Error refreshing token:', error);
      // Clear tokens on refresh failure
      localStorage.removeItem('ynab_access_token');
      localStorage.removeItem('ynab_refresh_token');
      localStorage.removeItem('ynab_token_expiry');
      throw error;
    }
  }

  private async fetchYNAB(endpoint: string, options: RequestInit = {}) {
    // Check if token needs refresh
    if (this.tokenExpiry && Date.now() >= this.tokenExpiry) {
      await this.refreshAccessToken();
    }

    const response = await fetch(`${YNAB_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 401) {
      // Token might be invalid, try refreshing
      try {
        await this.refreshAccessToken();
        // Retry the request with new token
        const retryResponse = await fetch(`${YNAB_API_BASE}${endpoint}`, {
          ...options,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });
        
        if (!retryResponse.ok) {
          const errorData = await retryResponse.json();
          throw new Error(`YNAB API error: ${errorData.error?.detail || retryResponse.statusText}`);
        }
        return retryResponse.json();
      } catch (refreshError) {
        // If refresh fails, clear tokens and throw error
        localStorage.removeItem('ynab_access_token');
        localStorage.removeItem('ynab_refresh_token');
        localStorage.removeItem('ynab_token_expiry');
        throw new Error('Authentication failed. Please reconnect to YNAB.');
      }
    }

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`YNAB API error: ${errorData.error?.detail || response.statusText}`);
    }

    return response.json();
  }

  async getBudgets() {
    try {
      const response = await this.fetchYNAB('/budgets');
      return response.data.budgets;
    } catch (error) {
      console.error('Error fetching budgets:', error);
      throw error;
    }
  }

  async getAccounts(budgetId: string) {
    try {
      const response = await this.fetchYNAB(`/budgets/${budgetId}/accounts`);
      return response.data.accounts;
    } catch (error) {
      console.error('Error fetching accounts:', error);
      throw error;
    }
  }

  async getAccountDetails(budgetId: string, accountId: string) {
    try {
      const response = await this.fetchYNAB(`/budgets/${budgetId}/accounts/${accountId}`);
      return response.data.account;
    } catch (error) {
      console.error('Error fetching account details:', error);
      throw error;
    }
  }

  async createTransactions(budgetId: string, transactions: YNABTransaction[]) {
    // Validate transactions
    const validTransactions = transactions.filter(t => {
      if (!t.date || !t.payee_name || !t.account_id) return false;
      if (typeof t.amount !== 'number' || isNaN(t.amount)) return false;
      return true;
    });

    if (validTransactions.length === 0) {
      throw new Error('No valid transactions to create');
    }

    try {
      const response = await this.fetchYNAB(`/budgets/${budgetId}/transactions`, {
        method: 'POST',
        body: JSON.stringify({
          transactions: validTransactions.map(t => ({
            account_id: t.account_id,
            date: t.date,
            amount: t.amount,
            payee_name: t.payee_name,
            memo: t.memo,
            cleared: t.cleared,
            approved: t.approved,
            import_id: `YNAB:${t.amount}:${t.date}:1`
          }))
        })
      });

      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to create transactions');
    }
  }
}

export const redirectToYNABAuthorize = () => {
  const params = new URLSearchParams({
    client_id: YNAB_OAUTH_CONFIG.clientId,
    redirect_uri: YNAB_OAUTH_CONFIG.redirectUri,
    response_type: 'code',
    scope: YNAB_OAUTH_CONFIG.scope,
  });

  window.location.href = `${YNAB_OAUTH_CONFIG.authUrl}?${params.toString()}`;
};
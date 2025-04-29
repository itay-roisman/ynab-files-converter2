export const YNAB_OAUTH_CONFIG = {
  clientId: process.env.NEXT_PUBLIC_YNAB_CLIENT_ID || '',
  clientSecret: process.env.NEXT_PUBLIC_YNAB_CLIENT_SECRET || '',
  authUrl: 'https://app.ynab.com/oauth/authorize',
  tokenUrl: 'https://app.ynab.com/oauth/token',
  redirectUri: process.env.NEXT_PUBLIC_YNAB_REDIRECT_URI || 'http://localhost:3000/oauth/callback',
  scope: '',

  // Helper method to validate configuration
  validate: function () {
    console.log('Validating OAuth configuration:', {
      hasClientId: !!this.clientId,
      hasClientSecret: !!this.clientSecret,
      hasRedirectUri: !!this.redirectUri,
      redirectUri: this.redirectUri,
      envClientSecret: process.env.NEXT_PUBLIC_YNAB_CLIENT_SECRET,
    });

    if (!this.clientId) {
      throw new Error('YNAB client ID is not configured');
    }
    if (!this.clientSecret) {
      throw new Error(
        'YNAB client secret is not configured. Please check your .env file and restart the server.'
      );
    }
    if (!this.redirectUri) {
      throw new Error('YNAB redirect URI is not configured');
    }
  },
};

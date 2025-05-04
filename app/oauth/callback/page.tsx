'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { YNAB_OAUTH_CONFIG } from '../../config/oauth';
import styles from './callback.module.css';

function OAuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      setError(`${error}: ${errorDescription || 'Unknown error occurred'}`);
      setIsLoading(false);
      return;
    }

    if (!code) {
      setError('No authorization code received');
      setIsLoading(false);
      return;
    }

    const exchangeCodeForToken = async () => {
      try {
        const response = await fetch('/api/oauth/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            redirect_uri: YNAB_OAUTH_CONFIG.redirectUri,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error_description || data.error || 'Failed to exchange code for token'
          );
        }

        // Store all token-related data
        localStorage.setItem('ynab_access_token', data.access_token);
        localStorage.setItem('ynab_refresh_token', data.refresh_token);
        localStorage.setItem('ynab_token_expiry', (Date.now() + data.expires_in * 1000).toString());

        router.push('/');
      } catch (err) {
        console.error('Token exchange error:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      } finally {
        setIsLoading(false);
      }
    };

    exchangeCodeForToken();
  }, [searchParams, router]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <h1>Connecting to YNAB...</h1>
        <p>Please wait while we complete the connection.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <h1>Error</h1>
        <p>{error}</p>
        <p>Please check the browser console for more details.</p>
        <button onClick={() => router.push('/')}>Return to Home</button>
      </div>
    );
  }

  return null;
}

// Loading fallback for the Suspense boundary
function LoadingCallback() {
  return (
    <div className={styles.container}>
      <h1>Loading...</h1>
      <p>Please wait while we initialize the page.</p>
    </div>
  );
}

export default function OAuthCallback() {
  return (
    <Suspense fallback={<LoadingCallback />}>
      <OAuthCallbackContent />
    </Suspense>
  );
}

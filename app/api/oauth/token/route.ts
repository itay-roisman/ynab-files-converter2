import { NextResponse } from 'next/server';
import { YNAB_OAUTH_CONFIG } from '../../../config/oauth';

export async function POST(request: Request) {
  try {
    // Validate OAuth configuration
    YNAB_OAUTH_CONFIG.validate();

    const { code } = await request.json();
    
    if (!code) {
      return NextResponse.json(
        { error: 'Authorization code is required' },
        { status: 400 }
      );
    }

    const authHeader = `Basic ${Buffer.from(
      `${YNAB_OAUTH_CONFIG.clientId}:${YNAB_OAUTH_CONFIG.clientSecret}`
    ).toString('base64')}`;

    const response = await fetch(YNAB_OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: YNAB_OAUTH_CONFIG.redirectUri, // Use the configured redirect URI
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Token exchange failed:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
        requestBody: {
          grant_type: 'authorization_code',
          code: '***', // Hide the actual code in logs
          redirect_uri: YNAB_OAUTH_CONFIG.redirectUri
        }
      });
      
      return NextResponse.json(
        { 
          error: errorData.error || 'Failed to exchange code for token',
          error_description: errorData.error_description || 'Unknown error occurred during token exchange'
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Token exchange error:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to exchange code for token',
        error_description: 'An unexpected error occurred during token exchange'
      },
      { status: 500 }
    );
  }
} 
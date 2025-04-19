import { NextResponse } from 'next/server';
import { YNAB_OAUTH_CONFIG } from '../../../config/oauth';

export async function POST(request: Request) {
  try {
    const { refresh_token } = await request.json();
    console.log('Token refresh request received');

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
        grant_type: 'refresh_token',
        refresh_token,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token refresh failed:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      throw new Error(`Failed to refresh token: ${errorText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to refresh token' },
      { status: 500 }
    );
  }
} 
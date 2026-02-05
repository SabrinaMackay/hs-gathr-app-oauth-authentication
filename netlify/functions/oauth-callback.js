// Step 3 & 4: Handle OAuth callback and exchange authorization code for tokens

const fetch = require('node-fetch');

const exchangeForTokens = async (exchangeProof) => {
  try {
    const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(exchangeProof).toString()
    });

    const tokens = await response.json();

    if (!response.ok) {
      console.error('Error exchanging authorization code:', tokens);
      console.error('       > Status:', response.status);
      console.error('       > Error type:', tokens.status || tokens.error);
      console.error('       > Error description:', tokens.error_description || tokens.message);

      // Provide helpful message for common errors
      if (tokens.status === 'BAD_AUTH_CODE' || tokens.error === 'invalid_request') {
        console.error('       > HINT: Authorization codes are single-use and expire quickly (5-10 minutes).');
        console.error('       > If you refreshed the page or clicked back, you need to restart from /install');
      }

      return { error: true, message: tokens.message || tokens.error_description || 'Token exchange failed' };
    }

    console.log('       > Successfully exchanged authorization code for tokens');
    return tokens;
  } catch (e) {
    console.error('       > Error exchanging authorization code for access token:', e.message);
    return { error: true, message: e.message };
  }
};

exports.handler = async (event, context) => {
  console.log('===> Step 3: Handling the OAuth callback from HubSpot');

  const CLIENT_ID = process.env.CLIENT_ID;
  const CLIENT_SECRET = process.env.CLIENT_SECRET;
  const REDIRECT_URI = process.env.REDIRECT_URI || `${process.env.URL}/oauth-callback`;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: '<h2>Error: Missing CLIENT_ID or CLIENT_SECRET environment variables</h2>'
    };
  }

  // Check if we received an authorization code
  const params = event.queryStringParameters || {};

  if (!params.code) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: '<h2>Error: No authorization code received</h2><p><a href="/">Go back</a></p>'
    };
  }

  const authCode = params.code;
  console.log('       > Received authorization code (first 20 chars):', authCode.substring(0, 20) + '...');

  const authCodeProof = {
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code: authCode
  };

  console.log('       > Token exchange parameters:');
  console.log('         - client_id:', CLIENT_ID);
  console.log('         - redirect_uri:', REDIRECT_URI);

  // Step 4: Exchange the authorization code for tokens
  console.log('===> Step 4: Exchanging authorization code for access token and refresh token');
  const tokens = await exchangeForTokens(authCodeProof);

  if (tokens.error) {
    const isBadAuthCode = tokens.message && (
      tokens.message.includes('auth code') ||
      tokens.message.includes('invalid_request')
    );

    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Error</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              max-width: 600px;
              margin: 50px auto;
              padding: 20px;
              text-align: center;
            }
            .error {
              color: #dc2626;
              background: #fee;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .info {
              background: #f0f9ff;
              border-left: 4px solid #0284c7;
              padding: 15px;
              margin: 20px 0;
              text-align: left;
            }
            .cta {
              display: inline-block;
              background: #0ea5e9;
              color: white;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 6px;
              margin-top: 20px;
            }
            .cta:hover {
              background: #0284c7;
            }
          </style>
        </head>
        <body>
          <h2>OAuth Error</h2>
          <div class="error">${tokens.message}</div>
          ${isBadAuthCode ? `
            <div class="info">
              <h3>What happened?</h3>
              <p>Authorization codes are single-use and expire within 5-10 minutes. This error typically occurs when:</p>
              <ul style="text-align: left; margin: 10px 0;">
                <li>The page was refreshed after the callback</li>
                <li>The browser back button was used</li>
                <li>The authorization code expired before use</li>
                <li>You're testing the OAuth flow repeatedly</li>
              </ul>
            </div>
            <a href="/.netlify/functions/install" class="cta">Start Fresh Installation</a>
          ` : `
            <p><a href="/.netlify/functions/install">Try installing again</a></p>
          `}
        </body>
        </html>
      `
    };
  }

  // Extract hub_id from token response (critical for multi-tenant)
  const hub_id = tokens.hub_id;

  if (!hub_id) {
    console.error('[ERROR] No hub_id in token response - this should not happen!');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: '<h2>Error: Missing hub_id in OAuth response</h2>'
    };
  }

  // Save tokens to cache and log for manual setup
  console.log('===> [OK] OAuth tokens received successfully!');
  console.log('       Portal ID:', hub_id);
  console.log('       Access Token (first 10 chars):', tokens.access_token.substring(0, 10) + '...');
  console.log('       Refresh Token (first 10 chars):', tokens.refresh_token.substring(0, 10) + '...');
  console.log('       Expires in:', tokens.expires_in, 'seconds');

  const { saveTokens } = require('./token-store');
  await saveTokens(hub_id, tokens);

  console.log('');
  console.log('[SETUP] For persistent storage, copy these tokens to your database keyed by hub_id:');
  console.log('   Portal ID (hub_id):', hub_id);
  console.log('   Access Token:', tokens.access_token);
  console.log('   Refresh Token:', tokens.refresh_token);
  console.log('');

  // Check for Gathr Statements custom object during installation
  console.log('===> Step 5: Checking for Gathr Statements custom object');
  let schemaResult = null;
  let schemaError = null;
  try {
    const { ensureGathrStatementsSchema } = require('./create-schema');
    schemaResult = await ensureGathrStatementsSchema(
      hub_id,
      'https://api.hubapi.com' // You can detect region from tokens if needed
    );

    if (schemaResult.exists) {
      console.log('[OK] Gathr Statements schema found:', {
        objectTypeId: schemaResult.objectTypeId
      });
    } else {
      console.log('[WARN] Gathr Statements schema not found - customer needs to create it manually');
    }
  } catch (error) {
    schemaError = error;
    console.error('[WARN] Failed to check Gathr Statements schema:', error.message);
    // Don't fail the entire OAuth flow - schema can be created manually
  }

  // Redirect back to HubSpot after successful OAuth installation
  return {
    statusCode: 302,
    headers: {
      'Location': `https://app.hubspot.com/${hub_id}`
    }
  };
};

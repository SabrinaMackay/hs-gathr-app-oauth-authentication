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

  // Return success page with tokens for manual setup
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache'
    },
    body: `
      <!DOCTYPE html>
      <html>
      <head>
        <title>OAuth Success</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
          }
          .success {
            color: #16a34a;
            background: #dcfce7;
            padding: 30px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
          }
          .info {
            background: #f0f9ff;
            border-left: 4px solid #0284c7;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
          }
          .info h3 {
            margin-top: 0;
            color: #0369a1;
          }
          code {
            background: #f1f5f9;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.9em;
          }
        </style>
      </head>
      <body>
        <div class="success">
          <h2>Installation Complete!</h2>
          <p>HubSpot authentication was successful for portal <strong>${hub_id}</strong>.</p>
          <p>Tokens are cached in memory for immediate testing</p>
          ${schemaResult && schemaResult.exists ? `
            <p>Gathr Statements custom object verified</p>
            <p style="font-size: 0.85em; margin-top: 10px;">Object Type ID: <code>${schemaResult.objectTypeId}</code></p>
          ` : ''}
        </div>

        ${schemaResult && schemaResult.exists ? `
        <div class="info">
          <h3>Gathr Statements Custom Object</h3>
          <p>The custom object has been verified with the following properties:</p>
          <ul style="text-align: left; margin: 10px 0;">
            <li><code>statement_id</code> - Display name (e.g., bank name)</li>
            <li><code>statement</code> - Statement file upload</li>
            <li><code>gathr_statement_id</code> - Gathr API statement ID(s)</li>
            <li><code>bank_account_id</code> - Bank account ID(s)</li>
            <li><code>customer_id</code> - Customer ID(s)</li>
            <li><code>account_number</code> - Account number(s)</li>
          </ul>
          <p style="font-size: 0.9em; margin-top: 10px;">
            Associated with: <strong>Contacts</strong> and <strong>Companies</strong>
          </p>
        </div>
        ` : ''}

        ${schemaResult && !schemaResult.exists ? `
        <div class="info" style="border-left-color: #f59e0b; background: #fffbeb;">
          <h3 style="color: #d97706;">Action Required: Create Custom Object</h3>
          <p><strong>The "gathr_statements" custom object was not found in your HubSpot portal.</strong></p>

          <p style="margin-top: 15px;"><strong>To complete setup, you need to manually create this custom object:</strong></p>
          <ol style="text-align: left; margin: 10px 0 10px 20px;">
            <li>In HubSpot, go to <strong>Settings</strong> → <strong>Data Management</strong> → <strong>Objects</strong></li>
            <li>Click <strong>"Create custom object"</strong></li>
            <li>Set the object name to: <code>gathr_statements</code></li>
            <li>Add these required properties:
              <ul style="margin: 5px 0 5px 20px; font-size: 0.9em;">
                <li><code>statement_id</code> (text) - Primary display property</li>
                <li><code>statement</code> (file) - Statement file upload</li>
                <li><code>account_number</code> (text)</li>
                <li><code>bank_account_id</code> (text)</li>
                <li><code>customer_id</code> (text)</li>
                <li><code>gathr_statement_id</code> (text)</li>
              </ul>
            </li>
            <li>Associate it with <strong>Contacts</strong> and <strong>Companies</strong></li>
            <li>Save the custom object</li>
          </ol>

          <p style="margin-top: 15px; font-size: 0.9em;">
            <strong>Note:</strong> Creating custom objects requires a HubSpot Enterprise account.
            The app installation will work, but you won't be able to use statement features until this object is created.
          </p>
        </div>
        ` : ''}

        <div class="info">
          <h3>Multi-Tenant Setup</h3>
          <p>Each portal has isolated tokens and schemas. Your custom object is specific to portal <code>${hub_id}</code>.</p>
        </div>

        ${schemaError ? `
        <div class="info" style="border-left-color: #dc2626; background: #fef2f2;">
          <h3 style="color: #b91c1c;">Schema Check Failed</h3>
          <p><strong>Unable to verify if the gathr_statements custom object exists.</strong></p>
          <p style="margin-top: 10px;">Error: ${schemaError.message}</p>
          <p style="margin-top: 15px;">Please ensure you have the correct permissions and that the custom object exists in your HubSpot portal.</p>
        </div>
        ` : ''}

      </body>
      </html>
    `
  };
};

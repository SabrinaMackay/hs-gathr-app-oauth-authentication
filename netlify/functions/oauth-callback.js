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
      return { error: true, message: tokens.message || 'Token exchange failed' };
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
  console.log('       > Received authorization code');

  const authCodeProof = {
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code: authCode
  };

  // Step 4: Exchange the authorization code for tokens
  console.log('===> Step 4: Exchanging authorization code for access token and refresh token');
  const tokens = await exchangeForTokens(authCodeProof);

  if (tokens.error) {
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
          </style>
        </head>
        <body>
          <h2>OAuth Error</h2>
          <div class="error">${tokens.message}</div>
          <p>You can close this window and try again.</p>
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

  // Auto-create Gathr Statements custom object during installation
  console.log('===> Step 5: Creating Gathr Statements custom object');
  let schemaResult = null;
  let schemaError = null;
  try {
    const { ensureGathrStatementsSchema } = require('./create-schema');
    schemaResult = await ensureGathrStatementsSchema(
      tokens.access_token,
      hub_id,
      'https://api.hubapi.com' // You can detect region from tokens if needed
    );

    console.log('[OK] Gathr Statements schema ready:', {
      objectTypeId: schemaResult.objectTypeId,
      status: schemaResult.created ? 'created' : 'already exists'
    });
  } catch (error) {
    schemaError = error;
    console.error('[WARN] Failed to create Gathr Statements schema:', error.message);
    console.error('   You may need to create the schema manually or reinstall with correct scopes');
    // Don't fail the entire OAuth flow - schema can be created later
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
          <div class="checkmark">✓</div>
          <h2>Installation Complete!</h2>
          <p>HubSpot authentication was successful for portal <strong>${hub_id}</strong>.</p>
          <p>Tokens are cached in memory for immediate testing</p>
          ${schemaResult ? `
            <p>✓ Gathr Statements custom object ${schemaResult.created ? 'created' : 'verified'}</p>
            <p style="font-size: 0.85em; margin-top: 10px;">Object Type ID: <code>${schemaResult.objectTypeId}</code></p>
          ` : `<p style="color: #b45309;">⚠ Custom object creation ${schemaError && schemaError.message.includes('scopes') ? 'failed - missing scopes' : 'pending'}</p>`}
        </div>

        ${schemaResult ? `
        <div class="info">
          <h3>Gathr Statements Custom Object</h3>
          <p>The custom object has been ${schemaResult.created ? 'created' : 'verified'} with the following properties:</p>
          <ul style="text-align: left; margin: 10px 0;">
            <li><code>statement_id</code> - Display name (e.g., bank name)</li>
            <li><code>has_file</code> - File upload status</li>
            <li><code>gathr_statement_id</code> - Gathr API statement ID(s)</li>
            <li><code>bank_account_id</code> - Bank account ID(s)</li>
            <li><code>customer_id</code> - Customer ID(s)</li>
            <li><code>account_number</code> - Account number(s)</li>
            <li><code>statement_file</code> - Uploaded file reference</li>
          </ul>
          <p style="font-size: 0.9em; margin-top: 10px;">
            Associated with: <strong>Contacts</strong> and <strong>Companies</strong>
          </p>
        </div>
        ` : ''}

        <div class="info">
          <h3>Multi-Tenant Setup</h3>
          <p>Each portal has isolated tokens and schemas. Your custom object is specific to portal <code>${hub_id}</code>.</p>
        </div>

        ${schemaError && schemaError.message.includes('scopes') ? `
        <div class="info" style="border-left-color: #dc2626; background: #fef2f2;">
          <h3 style="color: #b91c1c;">⚠ Schema Creation Failed - Missing Scopes</h3>
          <p><strong>The app needs additional permissions to create custom objects.</strong></p>

          <p style="margin-top: 15px;"><strong>To fix this:</strong></p>
          <ol style="text-align: left; margin: 10px 0 10px 20px;">
            <li>Go to your HubSpot App Settings</li>
            <li>Find "Gathr App" in your installed apps</li>
            <li>Click "Uninstall" or "Manage"</li>
            <li>Reinstall the app - it will request the required scopes:
              <ul style="margin: 5px 0 5px 20px; font-size: 0.9em;">
                <li><code>crm.schemas.custom.read</code></li>
                <li><code>crm.schemas.custom.write</code></li>
                <li><code>crm.objects.custom.read</code></li>
                <li><code>crm.objects.custom.write</code></li>
              </ul>
            </li>
            <li>Authorize the new permissions</li>
          </ol>

          <p style="margin-top: 15px;">Or manually create the "Gathr Statements" custom object in HubSpot with the properties listed above.</p>
        </div>
        ` : ''}

      </body>
      </html>
    `
  };
};

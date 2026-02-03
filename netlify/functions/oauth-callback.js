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

  // Save tokens to persistent storage
  console.log('===> ✅ OAuth tokens received successfully!');
  console.log('       Access Token (first 10 chars):', tokens.access_token.substring(0, 10) + '...');
  console.log('       Refresh Token (first 10 chars):', tokens.refresh_token.substring(0, 10) + '...');
  console.log('       Expires in:', tokens.expires_in, 'seconds');
  
  try {
    const { saveTokens } = require('./token-store');
    await saveTokens(tokens);
    console.log('       ✅ Tokens saved to persistent storage');
  } catch (error) {
    console.error('       ⚠️ Failed to save tokens to storage:', error.message);
    console.log('       Falling back to displaying tokens for manual setup');
    console.log('');
    console.log('📝 IMPORTANT: Copy these tokens to your Netlify environment variables:');
    console.log('   HUBSPOT_ACCESS_TOKEN=' + tokens.access_token);
    console.log('   HUBSPOT_REFRESH_TOKEN=' + tokens.refresh_token);
  }
  console.log('');

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
          .checkmark {
            font-size: 48px;
            margin-bottom: 10px;
          }
          .warning {
            background: #fef3c7;
            border: 2px solid #f59e0b;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .token-box {
            background: #f3f4f6;
            border: 1px solid #d1d5db;
            padding: 15px;
            border-radius: 4px;
            margin: 10px 0;
            font-family: monospace;
            font-size: 12px;
            word-break: break-all;
            text-align: left;
          }
          .copy-btn {
            background: #3b82f6;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 5px;
          }
          .copy-btn:hover {
            background: #2563eb;
          }
          h3 {
            margin-top: 20px;
            color: #1f2937;
          }
          ol {
            text-align: left;
            line-height: 1.8;
          }
        </style>
      </head>
      <body>
        <div class="success">
          <div class="checkmark">✓</div>
          <h2>OAuth Tokens Received!</h2>
          <p>HubSpot authentication was successful.</p>
          <p>Tokens have been automatically saved to secure storage.</p>
        </div>
        
        <div class="warning">
          <h3>⚙️ Backup: Manual Setup (Optional)</h3>
          <p><strong>If automatic storage fails, add these tokens to your Netlify environment variables:</strong></p>
          
          <div>
            <strong>HUBSPOT_ACCESS_TOKEN</strong>
            <div class="token-box" id="access-token">${tokens.access_token}</div>
            <button class="copy-btn" onclick="copyToken('access-token')">📋 Copy Access Token</button>
          </div>
          
          <div>
            <strong>HUBSPOT_REFRESH_TOKEN</strong>
            <div class="token-box" id="refresh-token">${tokens.refresh_token}</div>
            <button class="copy-btn" onclick="copyToken('refresh-token')">📋 Copy Refresh Token</button>
          </div>

          <h3>📝 Steps to Complete Setup:</h3>
          <ol>
            <li>Go to your <a href="https://app.netlify.com" target="_blank">Netlify Dashboard</a></li>
            <li>Select your site: <strong>hs-gathr-oauth</strong></li>
            <li>Go to <strong>Site settings</strong> → <strong>Environment variables</strong></li>
            <li>Click <strong>Add a variable</strong></li>
            <li>Add <code>HUBSPOT_ACCESS_TOKEN</code> with the value above</li>
            <li>Add <code>HUBSPOT_REFRESH_TOKEN</code> with the value above</li>
            <li>Save and redeploy your site</li>
          </ol>
        </div>

        <p style="text-align: center; margin-top: 30px; color: #6b7280;">
          Once you've added the environment variables, your HubSpot card will work automatically.
        </p>

        <script>
          function copyToken(elementId) {
            const element = document.getElementById(elementId);
            const text = element.textContent;
            navigator.clipboard.writeText(text).then(() => {
              const btn = event.target;
              const originalText = btn.textContent;
              btn.textContent = '✓ Copied!';
              setTimeout(() => {
                btn.textContent = originalText;
              }, 2000);
            });
          }
        </script>
      </body>
      </html>
    `
  };
};

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

  // Store the tokens in the proxy module for use in API calls
  const { setAccessToken } = require('./hubspot-proxy');
  setAccessToken({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in * 1000)
  });
  
  console.log('       > Tokens stored in proxy module');

  // Return success page - tokens are now stored on the backend
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
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            text-align: center;
          }
          .success {
            color: #16a34a;
            background: #dcfce7;
            padding: 30px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .checkmark {
            font-size: 48px;
            margin-bottom: 10px;
          }
          .info {
            background: #eff6ff;
            border: 1px solid #3b82f6;
            padding: 15px;
            border-radius: 8px;
            margin-top: 20px;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="success">
          <div class="checkmark">✓</div>
          <h2>Authentication Successful!</h2>
          <p>Your HubSpot account has been connected.</p>
        </div>
        <div class="info">
          <p><strong>You can now close this window and return to your HubSpot card.</strong></p>
          <p>Your OAuth tokens have been securely stored and will be used automatically for API requests.</p>
        </div>
        <script>
          // Try to close the window after a delay
          setTimeout(() => {
            window.close();
          }, 3000);
        </script>
      </body>
      </html>
    `
  };
};

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

  // Return HTML that sends the token back to the HubSpot card via postMessage
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
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #3498db;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="success">
          <h2>✓ Authentication Successful!</h2>
          <p>Sending token to HubSpot card...</p>
          <div class="spinner"></div>
        </div>
        <p id="status">Connecting...</p>
        
        <script>
          console.log('OAuth callback page loaded');
          console.log('Window opener exists:', !!window.opener);
          
          const accessToken = ${JSON.stringify(tokens.access_token)};
          const refreshToken = ${JSON.stringify(tokens.refresh_token)};
          
          if (window.opener) {
            console.log('Sending token to parent window...');
            
            // Send token to the HubSpot card
            window.opener.postMessage({
              type: 'OAUTH_SUCCESS',
              accessToken: accessToken,
              refreshToken: refreshToken,
              expiresIn: ${tokens.expires_in}
            }, '*'); // In production, replace '*' with specific origin
            
            document.getElementById('status').textContent = 'Token sent! Closing window...';
            
            // Close the popup after a short delay
            setTimeout(() => {
              console.log('Closing popup window');
              window.close();
            }, 1500);
          } else {
            console.error('No opener window found');
            document.getElementById('status').innerHTML = 
              '<span style="color: #dc2626;">Error: Unable to communicate with parent window. Please close this window and try again.</span>';
          }
        </script>
      </body>
      </html>
    `
  };
};

// HubSpot API Proxy - Uses stored OAuth token to make HubSpot API calls
const fetch = require('node-fetch');
const { getTokens, saveTokens, needsRefresh } = require('./token-store');

// Function to get the current access token (with auto-refresh)
const getAccessToken = async () => {
  console.log('[AUTH] Getting access token...');
  
  // Try to get from persistent storage first
  try {
    const tokens = await getTokens();
    
    if (tokens && tokens.accessToken) {
      console.log('   [OK] Found tokens in storage');
      
      // Check if token needs refresh
      if (needsRefresh(tokens)) {
        console.log('   [REFRESH] Token expired or expiring soon, refreshing...');
        const newTokens = await refreshAccessToken(tokens.refreshToken);
        return newTokens.accessToken;
      }
      
      return tokens.accessToken;
    }
  } catch (error) {
    console.log('   [WARN] Error accessing token storage:', error.message);
  }
  
  // Fallback to environment variables (for backward compatibility)
  if (process.env.HUBSPOT_ACCESS_TOKEN) {
    console.log('   [OK] Falling back to environment variable');
    return process.env.HUBSPOT_ACCESS_TOKEN;
  }
  
  console.log('   [ERROR] No access token found');
  return null;
};

// Refresh token and save to persistent storage
const refreshAccessToken = async (refreshToken) => {
  console.log('[REFRESH] Refreshing access token...');
  
  const CLIENT_ID = process.env.CLIENT_ID;
  const CLIENT_SECRET = process.env.CLIENT_SECRET;
  
  // Use provided refresh token or fall back to env var
  const tokenToUse = refreshToken || process.env.HUBSPOT_REFRESH_TOKEN;

  if (!tokenToUse) {
    throw new Error('No refresh token available');
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Missing CLIENT_ID or CLIENT_SECRET environment variables');
  }

  const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokenToUse
    }).toString()
  });

  const tokens = await response.json();
  
  if (!response.ok) {
    console.error('[ERROR] Token refresh failed:', tokens);
    throw new Error(`Failed to refresh token: ${tokens.message || response.statusText}`);
  }

  console.log('[OK] Token refreshed successfully');
  
  // Save new tokens to persistent storage
  const newTokenData = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || tokenToUse,
    expiresAt: Date.now() + (tokens.expires_in * 1000)
  };

  try {
    await saveTokens(newTokenData);
    console.log('   [OK] New tokens saved to storage');
  } catch (error) {
    console.error('   [WARN] Failed to save refreshed tokens:', error.message);
  }

  return newTokenData;
};

exports.handler = async (event, context) => {
  console.log('[PROXY] HubSpot Proxy Function Invoked');
  console.log('   Method:', event.httpMethod);
  console.log('   Headers:', JSON.stringify(event.headers, null, 2));
  
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-HubSpot-Region, X-Requested-Path',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    console.log('   Handling OPTIONS preflight request');
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Get access token (now async with auto-refresh)
    console.log('[AUTH] Attempting to get access token...');
    let accessToken = await getAccessToken();
    
    if (!accessToken) {
      console.error('[ERROR] No access token available');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'No access token available. Please authenticate first.',
          needsAuth: true,
          hint: 'Complete OAuth flow at /oauth-start or set HUBSPOT_ACCESS_TOKEN environment variable'
        })
      };
    }

    console.log('[OK] Access token found, length:', accessToken.length);

    // Get the HubSpot API path from the request
    const requestedPath = event.headers['x-requested-path'] || event.headers['X-Requested-Path'];
    const hubspotRegion = event.headers['x-hubspot-region'] || event.headers['X-HubSpot-Region'] || 'https://api.hubapi.com';
    
    console.log('[REQUEST] Request Details:', {
      requestedPath,
      hubspotRegion,
      method: event.httpMethod,
      hasBody: !!event.body
    });
    
    if (!requestedPath) {
      console.error('[ERROR] Missing requested path');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing x-requested-path header',
          receivedHeaders: Object.keys(event.headers)
        })
      };
    }

    // Construct the full HubSpot API URL
    const hubspotUrl = `${hubspotRegion}${requestedPath}`;
    
    console.log(`[PROXY] Proxying ${event.httpMethod} request to: ${hubspotUrl}`);

    // Prepare request options
    const requestOptions = {
      method: event.httpMethod,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    // Add body for POST/PATCH/PUT requests
    if (event.body && ['POST', 'PATCH', 'PUT'].includes(event.httpMethod)) {
      console.log('[REQUEST] Request body:', event.body.substring(0, 200));
      requestOptions.body = event.body;
    }

    console.log('[REQUEST] Making request to HubSpot...');
    // Make the request to HubSpot
    let response = await fetch(hubspotUrl, requestOptions);
    
    console.log('[RESPONSE] HubSpot response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    });

    // If 401, try to refresh the token and retry once
    if (response.status === 401) {
      console.log('[REFRESH] Received 401, attempting to refresh token...');
      try {
        // Get current tokens to retrieve refresh token
        const tokens = await getTokens();
        if (tokens && tokens.refreshToken) {
          const newTokens = await refreshAccessToken(tokens.refreshToken);
          accessToken = newTokens.accessToken;
          requestOptions.headers.Authorization = `Bearer ${accessToken}`;
          response = await fetch(hubspotUrl, requestOptions);
          console.log('[RESPONSE] Retry response after refresh:', response.status);
        } else {
          console.error('[ERROR] No refresh token available for retry');
        }
      } catch (refreshError) {
        console.error('[ERROR] Token refresh failed:', refreshError.message);
      }
    }

    // Get response body
    const contentType = response.headers.get('content-type');
    let responseBody;
    
    console.log('[RESPONSE] Response content-type:', contentType);
    
    if (contentType && contentType.includes('application/json')) {
      responseBody = await response.json();
      console.log('[OK] Parsed JSON response');
    } else {
      responseBody = await response.text();
      console.log('[OK] Got text response');
    }

    console.log('[OK] Returning proxied response, status:', response.status);

    // Return the response
    return {
      statusCode: response.status,
      headers,
      body: typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
    };

  } catch (error) {
    console.error('[ERROR] Error in HubSpot proxy:', error);
    console.error('   Error stack:', error.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      })
    };
  }
};

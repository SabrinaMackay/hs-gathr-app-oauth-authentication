// HubSpot API Proxy - Uses stored OAuth token to make HubSpot API calls
const fetch = require('node-fetch');

// Function to get the current access token from environment variables
const getAccessToken = () => {
  console.log('🔑 Getting access token from environment');
  console.log('   HUBSPOT_ACCESS_TOKEN exists:', !!process.env.HUBSPOT_ACCESS_TOKEN);
  
  if (process.env.HUBSPOT_ACCESS_TOKEN) {
    console.log('   ✓ Found access token in environment');
    return process.env.HUBSPOT_ACCESS_TOKEN;
  }
  
  console.log('   ✗ No access token found');
  return null;
};

// Refresh token if needed
const refreshAccessToken = async () => {
  const CLIENT_ID = process.env.CLIENT_ID;
  const CLIENT_SECRET = process.env.CLIENT_SECRET;
  const refreshToken = process.env.HUBSPOT_REFRESH_TOKEN || storedToken?.refreshToken;

  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken
    }).toString()
  });

  const tokens = await response.json();
  
  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${tokens.message}`);
  }

  storedToken = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || refreshToken,
    expiresAt: Date.now() + (tokens.expires_in * 1000)
  };

  return storedToken.accessToken;
};

exports.handler = async (event, context) => {
  console.log('🚀 HubSpot Proxy Function Invoked');
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
    // Get access token
    console.log('🔐 Attempting to get access token...');
    let accessToken = getAccessToken();
    
    if (!accessToken) {
      console.error('❌ No access token available');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'No access token available. Please authenticate first.',
          needsAuth: true,
          hint: 'Set HUBSPOT_ACCESS_TOKEN environment variable in Netlify'
        })
      };
    }

    console.log('✓ Access token found, length:', accessToken.length);

    // Get the HubSpot API path from the request
    const requestedPath = event.headers['x-requested-path'] || event.headers['X-Requested-Path'];
    const hubspotRegion = event.headers['x-hubspot-region'] || event.headers['X-HubSpot-Region'] || 'https://api.hubapi.com';
    
    console.log('📊 Request Details:', {
      requestedPath,
      hubspotRegion,
      method: event.httpMethod,
      hasBody: !!event.body
    });
    
    if (!requestedPath) {
      console.error('❌ Missing requested path');
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
    
    console.log(`🌐 Proxying ${event.httpMethod} request to: ${hubspotUrl}`);

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
      console.log('📦 Request body:', event.body.substring(0, 200));
      requestOptions.body = event.body;
    }

    console.log('📤 Making request to HubSpot...');
    // Make the request to HubSpot
    let response = await fetch(hubspotUrl, requestOptions);
    
    console.log('📥 HubSpot response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    });

    // If 401, try to refresh the token and retry once
    if (response.status === 401 && process.env.HUBSPOT_REFRESH_TOKEN) {
      console.log('🔄 Access token expired, refreshing...');
      accessToken = await refreshAccessToken();
      requestOptions.headers.Authorization = `Bearer ${accessToken}`;
      response = await fetch(hubspotUrl, requestOptions);
      console.log('📥 Retry response:', response.status);
    }

    // Get response body
    const contentType = response.headers.get('content-type');
    let responseBody;
    
    console.log('📄 Response content-type:', contentType);
    
    if (contentType && contentType.includes('application/json')) {
      responseBody = await response.json();
      console.log('✓ Parsed JSON response');
    } else {
      responseBody = await response.text();
      console.log('✓ Got text response');
    }

    console.log('✅ Returning proxied response, status:', response.status);

    // Return the response
    return {
      statusCode: response.status,
      headers,
      body: typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
    };

  } catch (error) {
    console.error('❌ Error in HubSpot proxy:', error);
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

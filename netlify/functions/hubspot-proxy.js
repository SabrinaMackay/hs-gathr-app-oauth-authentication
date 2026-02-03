// HubSpot API Proxy - Uses stored OAuth token to make HubSpot API calls
const fetch = require('node-fetch');

// Simple in-memory token storage (for demo - use a database for production)
let storedToken = null;

// Function to get the current access token (from environment or stored)
const getAccessToken = () => {
  // First, check if there's a token in environment variables (for single-user setup)
  if (process.env.HUBSPOT_ACCESS_TOKEN) {
    return process.env.HUBSPOT_ACCESS_TOKEN;
  }
  // Otherwise, use the stored token (set during OAuth callback)
  return storedToken;
};

// Function to set the access token (called by oauth-callback)
const setAccessToken = (token) => {
  storedToken = token;
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
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-HubSpot-Region, X-Requested-Path',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Get access token
    let accessToken = getAccessToken();
    
    if (!accessToken) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'No access token available. Please authenticate first.',
          needsAuth: true
        })
      };
    }

    // Get the HubSpot API path from the request
    const requestedPath = event.headers['x-requested-path'] || event.queryStringParameters?.path;
    const hubspotRegion = event.headers['x-hubspot-region'] || 'https://api.hubapi.com';
    
    if (!requestedPath) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing x-requested-path header or path parameter' })
      };
    }

    // Construct the full HubSpot API URL
    const hubspotUrl = `${hubspotRegion}${requestedPath}`;
    
    console.log(`Proxying ${event.httpMethod} request to: ${hubspotUrl}`);

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
      requestOptions.body = event.body;
    }

    // Make the request to HubSpot
    let response = await fetch(hubspotUrl, requestOptions);

    // If 401, try to refresh the token and retry once
    if (response.status === 401 && process.env.HUBSPOT_REFRESH_TOKEN) {
      console.log('Access token expired, refreshing...');
      accessToken = await refreshAccessToken();
      requestOptions.headers.Authorization = `Bearer ${accessToken}`;
      response = await fetch(hubspotUrl, requestOptions);
    }

    // Get response body
    const contentType = response.headers.get('content-type');
    let responseBody;
    
    if (contentType && contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    // Return the response
    return {
      statusCode: response.status,
      headers,
      body: typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
    };

  } catch (error) {
    console.error('Error in HubSpot proxy:', error);
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

// Export functions for use by oauth-callback
exports.setAccessToken = setAccessToken;
exports.getAccessToken = getAccessToken;

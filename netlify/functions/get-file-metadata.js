// Fetch HubSpot File Metadata
// This endpoint fetches file metadata from HubSpot Files API
// Uses stored OAuth token from the proxy

const fetch = require('node-fetch');
const { getTokens, needsRefresh, saveTokens } = require('./token-store');

// Get the current access token (with auto-refresh)
// MULTI-TENANT: Requires hub_id to retrieve the correct portal's tokens
const getAccessToken = async (hub_id) => {
  console.log('[AUTH] Getting access token for portal:', hub_id);

  try {
    const tokens = await getTokens(hub_id);

    if (tokens && tokens.accessToken) {
      console.log('   [OK] Found tokens in storage for portal:', hub_id);

      // Check if token needs refresh
      if (needsRefresh(tokens)) {
        console.log('   [REFRESH] Token expired or expiring soon, refreshing...');
        const newTokens = await refreshAccessToken(hub_id, tokens.refreshToken);
        return newTokens.accessToken;
      }

      return tokens.accessToken;
    }
  } catch (error) {
    console.log('   [WARN] Error accessing token storage:', error.message);
  }

  // Fallback to environment variables (single-tenant dev/test only)
  if (process.env.HUBSPOT_ACCESS_TOKEN) {
    console.log('   [OK] Falling back to environment variable (single-tenant mode)');
    return process.env.HUBSPOT_ACCESS_TOKEN;
  }

  console.log('   [ERROR] No access token found for portal:', hub_id);
  return null;
};

// Refresh token helper
// MULTI-TENANT: Requires hub_id to save the refreshed tokens for the correct portal
const refreshAccessToken = async (hub_id, refreshToken) => {
  console.log('[REFRESH] Refreshing access token for portal:', hub_id);

  const CLIENT_ID = process.env.CLIENT_ID;
  const CLIENT_SECRET = process.env.CLIENT_SECRET;

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

  // CRITICAL: Validate that the refreshed token belongs to the requested portal
  const actualHubId = tokens.hub_id ? tokens.hub_id.toString() : null;
  const requestedHubId = hub_id ? hub_id.toString() : null;

  if (actualHubId && requestedHubId && actualHubId !== requestedHubId) {
    console.error('[ERROR] Token hub_id mismatch!');
    console.error('   Requested portal:', requestedHubId);
    console.error('   Token belongs to:', actualHubId);
    throw new Error(
      `Token mismatch: Your cached/env tokens belong to portal ${actualHubId}, but you're trying to access portal ${requestedHubId}. ` +
      `Please complete OAuth installation for portal ${requestedHubId}.`
    );
  }

  console.log('[OK] Token refreshed successfully for portal:', actualHubId || hub_id);

  const newTokenData = {
    hub_id: actualHubId || hub_id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || tokenToUse,
    expiresAt: Date.now() + (tokens.expires_in * 1000)
  };

  try {
    await saveTokens(actualHubId || hub_id, newTokenData);
    console.log('   [OK] New tokens saved to storage for portal:', actualHubId || hub_id);
  } catch (error) {
    console.error('   [WARN] Failed to save refreshed tokens:', error.message);
  }

  return newTokenData;
};

exports.handler = async (event, context) => {
  console.log('[GET FILE] Get File Metadata Function Invoked');

  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    console.log('   Handling OPTIONS preflight request');
    return { statusCode: 200, headers, body: '' };
  }

  // Only accept POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
    };
  }

  try {
    // Parse request body
    const body = JSON.parse(event.body);
    const { fileId, hubspotRegion, hub_id } = body;

    console.log('[REQUEST] Get file metadata request:', {
      fileId,
      hubspotRegion,
      hub_id
    });

    // Validate required fields
    if (!fileId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required field: fileId is required'
        })
      };
    }

    // MULTI-TENANT: hub_id is required to retrieve the correct portal's tokens
    if (!hub_id) {
      console.error('[ERROR] Missing hub_id in request body');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'hub_id is required in request body for multi-tenant authentication',
          hint: 'Include the HubSpot portal ID in your request: { "hub_id": "123456" }'
        })
      };
    }

    // Get access token for this specific portal
    let accessToken = await getAccessToken(hub_id);

    if (!accessToken) {
      console.error('[ERROR] No access token available');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          error: 'No access token available. Please authenticate first.',
          needsAuth: true
        })
      };
    }

    console.log('[OK] Access token found');

    // Construct HubSpot Files API URL
    const region = hubspotRegion || 'https://api-eu1.hubapi.com';
    const hubspotUrl = `${region}/files/v3/files/${fileId}`;

    console.log('[HUBSPOT] Fetching file metadata:', {
      url: hubspotUrl,
      fileId
    });

    const requestStart = Date.now();

    // Make the request to HubSpot
    let response = await fetch(hubspotUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const requestDuration = Date.now() - requestStart;

    console.log('[HUBSPOT] Response received:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      duration: requestDuration
    });

    // If 401, try to refresh token and retry once
    if (response.status === 401) {
      console.log('[REFRESH] Received 401, attempting to refresh token for portal:', hub_id);
      try {
        const tokens = await getTokens(hub_id);
        if (tokens && tokens.refreshToken) {
          const newTokens = await refreshAccessToken(hub_id, tokens.refreshToken);
          accessToken = newTokens.accessToken;

          // Retry request with new token
          response = await fetch(hubspotUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          });

          console.log('[HUBSPOT] Retry response after refresh:', response.status);
        }
      } catch (refreshError) {
        console.error('[ERROR] Token refresh failed:', refreshError.message);
      }
    }

    // Get response body
    const contentType = response.headers.get('content-type');
    let responseBody;

    if (contentType && contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    // Handle error responses
    if (!response.ok) {
      console.error('[ERROR] Failed to fetch file metadata:', {
        status: response.status,
        statusText: response.statusText,
        responseBody
      });

      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: 'Failed to fetch file metadata',
          status: response.status,
          message: responseBody.message || response.statusText,
          details: responseBody
        })
      };
    }

    // Success!
    console.log('[OK] File metadata fetched successfully:', {
      fileId,
      fileName: responseBody.name,
      fileUrl: responseBody.url,
      fileSize: responseBody.size,
      fileType: responseBody.type,
      fileExtension: responseBody.extension,
      duration: requestDuration
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        fileId,
        metadata: responseBody,
        duration: requestDuration
      })
    };

  } catch (error) {
    console.error('[ERROR] Error fetching file metadata:', error);
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

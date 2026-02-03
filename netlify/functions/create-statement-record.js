// Create and Associate HubSpot Statement Record
// This endpoint creates a new statement record and associates it with a contact/company
// Uses stored OAuth token from the proxy

const fetch = require('node-fetch');
const { getTokens, needsRefresh, saveTokens } = require('./token-store');

// Get the current access token (with auto-refresh)
const getAccessToken = async () => {
  console.log('[AUTH] Getting access token...');

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

  // Fallback to environment variables
  if (process.env.HUBSPOT_ACCESS_TOKEN) {
    console.log('   [OK] Falling back to environment variable');
    return process.env.HUBSPOT_ACCESS_TOKEN;
  }

  console.log('   [ERROR] No access token found');
  return null;
};

// Refresh token helper
const refreshAccessToken = async (refreshToken) => {
  console.log('[REFRESH] Refreshing access token...');

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

  console.log('[OK] Token refreshed successfully');

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

// Make HubSpot API call with token refresh retry
const makeHubSpotRequest = async (url, options, accessToken) => {
  let response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  // If 401, try to refresh token and retry once
  if (response.status === 401) {
    console.log('[REFRESH] Received 401, attempting to refresh token...');
    try {
      const tokens = await getTokens();
      if (tokens && tokens.refreshToken) {
        const newTokens = await refreshAccessToken(tokens.refreshToken);
        accessToken = newTokens.accessToken;
        
        // Retry request with new token
        response = await fetch(url, {
          ...options,
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...options.headers
          }
        });
        
        console.log('[HUBSPOT] Retry response after refresh:', response.status);
      }
    } catch (refreshError) {
      console.error('[ERROR] Token refresh failed:', refreshError.message);
    }
  }

  return response;
};

exports.handler = async (event, context) => {
  console.log('[CREATE RECORD] Create Statement Record Function Invoked');

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
    const { statementId, currentObjectTypeId, currentRecordId, hubspotRegion } = body;

    console.log('[REQUEST] Create record request:', {
      statementId,
      currentObjectTypeId,
      currentRecordId,
      hubspotRegion
    });

    // Validate required fields
    if (!statementId || !currentObjectTypeId || !currentRecordId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required fields: statementId, currentObjectTypeId, and currentRecordId are required'
        })
      };
    }

    // Get access token
    let accessToken = await getAccessToken();

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

    // Construct HubSpot API URL
    const GATHR_STATEMENT_OBJECT_TYPE_ID = "2-197849905";
    const region = hubspotRegion || 'https://api-eu1.hubapi.com';

    // Step 1: Create the new statement record
    const createUrl = `${region}/crm/v3/objects/${GATHR_STATEMENT_OBJECT_TYPE_ID}`;

    console.log('[HUBSPOT] Creating statement record:', {
      url: createUrl,
      statementId: statementId
    });

    const createResponse = await makeHubSpotRequest(
      createUrl,
      {
        method: 'POST',
        body: JSON.stringify({
          properties: {
            statement_id: statementId
          }
        })
      },
      accessToken
    );

    console.log('[HUBSPOT] Create response:', {
      status: createResponse.status,
      ok: createResponse.ok
    });

    // Get response body
    const contentType = createResponse.headers.get('content-type');
    let createResponseBody;

    if (contentType && contentType.includes('application/json')) {
      createResponseBody = await createResponse.json();
    } else {
      createResponseBody = await createResponse.text();
    }

    // Handle error responses
    if (!createResponse.ok) {
      console.error('[ERROR] Failed to create statement record:', {
        status: createResponse.status,
        statusText: createResponse.statusText,
        responseBody: createResponseBody
      });

      return {
        statusCode: createResponse.status,
        headers,
        body: JSON.stringify({
          error: 'Failed to create statement record',
          status: createResponse.status,
          message: createResponseBody.message || createResponse.statusText,
          details: createResponseBody
        })
      };
    }

    const newRecordId = createResponseBody.id;
    console.log('[OK] Statement record created:', newRecordId);

    // Step 2: Associate the new record with the current contact/company
    const associateUrl = `${region}/crm/v4/objects/${currentObjectTypeId}/${currentRecordId}/associations/default/${GATHR_STATEMENT_OBJECT_TYPE_ID}/${newRecordId}`;

    console.log('[HUBSPOT] Associating record:', {
      url: associateUrl,
      from: { objectTypeId: currentObjectTypeId, objectId: currentRecordId },
      to: { objectTypeId: GATHR_STATEMENT_OBJECT_TYPE_ID, objectId: newRecordId }
    });

    const associateResponse = await makeHubSpotRequest(
      associateUrl,
      {
        method: 'PUT'
      },
      accessToken
    );

    console.log('[HUBSPOT] Associate response:', {
      status: associateResponse.status,
      ok: associateResponse.ok
    });

    // Get response body
    const associateContentType = associateResponse.headers.get('content-type');
    let associateResponseBody;

    if (associateContentType && associateContentType.includes('application/json')) {
      associateResponseBody = await associateResponse.json();
    } else {
      associateResponseBody = await associateResponse.text();
    }

    // Handle error responses
    if (!associateResponse.ok) {
      console.error('[ERROR] Failed to associate record:', {
        status: associateResponse.status,
        statusText: associateResponse.statusText,
        responseBody: associateResponseBody
      });

      return {
        statusCode: associateResponse.status,
        headers,
        body: JSON.stringify({
          error: 'Failed to associate record',
          status: associateResponse.status,
          message: associateResponseBody.message || associateResponse.statusText,
          details: associateResponseBody,
          note: 'Record was created but association failed',
          createdRecordId: newRecordId
        })
      };
    }

    // Success!
    console.log('[OK] Statement record created and associated successfully:', {
      newRecordId,
      statementId,
      associatedWith: { objectTypeId: currentObjectTypeId, objectId: currentRecordId }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        recordId: newRecordId,
        statementId,
        message: 'Statement record created and associated successfully'
      })
    };

  } catch (error) {
    console.error('[ERROR] Error creating/associating statement record:', error);
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

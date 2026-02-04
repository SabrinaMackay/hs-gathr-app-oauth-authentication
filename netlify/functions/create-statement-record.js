// Create and Associate HubSpot Statement Record
// This endpoint creates a new statement record and associates it with a contact/company
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

// Make HubSpot API call with token refresh retry
// MULTI-TENANT: Requires hub_id to refresh tokens for the correct portal
const makeHubSpotRequest = async (url, options, accessToken, hub_id) => {
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
    console.log('[REFRESH] Received 401, attempting to refresh token for portal:', hub_id);
    try {
      const tokens = await getTokens(hub_id);
      if (tokens && tokens.refreshToken) {
        const newTokens = await refreshAccessToken(hub_id, tokens.refreshToken);
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
    const { statementId, currentObjectTypeId, currentRecordId, hubspotRegion, hub_id } = body;

    console.log('[REQUEST] Create record request:', {
      statementId,
      currentObjectTypeId,
      currentRecordId,
      hubspotRegion,
      hub_id
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

    // Get the Gathr Statements object type ID (portal-specific)
    const { getGathrStatementsObjectTypeId } = require('./create-schema');
    const region = hubspotRegion || 'https://api-eu1.hubapi.com';

    let GATHR_STATEMENT_OBJECT_TYPE_ID;
    try {
      GATHR_STATEMENT_OBJECT_TYPE_ID = await getGathrStatementsObjectTypeId(hub_id, region);

      if (!GATHR_STATEMENT_OBJECT_TYPE_ID) {
        console.error('[ERROR] Gathr Statements custom object not found');
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            error: 'Gathr Statements custom object not found in this portal',
            hint: 'Please complete the installation process or create the custom object manually',
            hub_id: hub_id
          })
        };
      }

      console.log('[OK] Found Gathr Statements object type ID:', GATHR_STATEMENT_OBJECT_TYPE_ID);
    } catch (lookupError) {
      console.error('[ERROR] Failed to lookup object type ID:', lookupError.message);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Failed to lookup Gathr Statements custom object',
          message: lookupError.message
        })
      };
    }

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
      accessToken,
      hub_id
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

    // Step 2: Fetch available association types between source object and custom object
    console.log('[HUBSPOT] Fetching association types between', currentObjectTypeId, 'and', GATHR_STATEMENT_OBJECT_TYPE_ID);

    const associationSchemaUrl = `${region}/crm/v4/associations/${currentObjectTypeId}/${GATHR_STATEMENT_OBJECT_TYPE_ID}/labels`;

    let associationTypeId;
    let associationCategory = 'HUBSPOT_DEFINED';

    try {
      const schemaResponse = await makeHubSpotRequest(
        associationSchemaUrl,
        { method: 'GET' },
        accessToken,
        hub_id
      );

      if (schemaResponse.ok) {
        const schemaResponseBody = await schemaResponse.json();
        console.log('[HUBSPOT] Association schema response:', schemaResponseBody);

        if (schemaResponseBody.results && schemaResponseBody.results.length > 0) {
          // Use the first primary association type
          const primaryAssoc = schemaResponseBody.results.find(a => a.label && a.label.toLowerCase().includes('primary'))
            || schemaResponseBody.results[0];

          associationTypeId = primaryAssoc.typeId;
          associationCategory = primaryAssoc.category || 'HUBSPOT_DEFINED';

          console.log('[OK] Found association type:', {
            typeId: associationTypeId,
            category: associationCategory,
            label: primaryAssoc.label
          });
        } else {
          console.log('[WARN] No association types found in schema response');
        }
      } else {
        const errorBody = await schemaResponse.text();
        console.log('[WARN] Failed to fetch association schema:', schemaResponse.status, errorBody);
      }
    } catch (error) {
      console.log('[WARN] Error fetching association schema:', error.message);
    }

    // If we couldn't find the association type, return error
    if (!associationTypeId) {
      console.error('[ERROR] Could not determine association type');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Association type not found',
          message: 'Could not find association type between ' + currentObjectTypeId + ' and ' + GATHR_STATEMENT_OBJECT_TYPE_ID,
          hint: 'Please ensure the custom object schema defines associations with contacts/companies',
          createdRecordId: newRecordId,
          note: 'Record was created but could not be associated'
        })
      };
    }

    // Step 3: Create the association
    const associateUrl = `${region}/crm/v4/objects/${currentObjectTypeId}/${currentRecordId}/associations/${GATHR_STATEMENT_OBJECT_TYPE_ID}/${newRecordId}`;

    const associationPayload = [
      {
        associationCategory: associationCategory,
        associationTypeId: associationTypeId
      }
    ];

    console.log('[HUBSPOT] Creating association:', {
      url: associateUrl,
      from: { objectTypeId: currentObjectTypeId, objectId: currentRecordId },
      to: { objectTypeId: GATHR_STATEMENT_OBJECT_TYPE_ID, objectId: newRecordId },
      payload: associationPayload
    });

    const associateResponse = await makeHubSpotRequest(
      associateUrl,
      {
        method: 'PUT',
        body: JSON.stringify(associationPayload)
      },
      accessToken,
      hub_id
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

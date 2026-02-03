// Update HubSpot Statement Record with Gathr Data
// This endpoint centralizes the business logic for updating statement records
// Uses stored OAuth token from the proxy

const fetch = require('node-fetch');
const { getTokens, needsRefresh } = require('./token-store');

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
        // Import refreshAccessToken function
        const { refreshAccessToken } = require('./hubspot-proxy');
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

// Refresh token helper (duplicated from hubspot-proxy for independence)
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

  const { saveTokens } = require('./token-store');
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
  console.log('[UPDATE RECORD] Update Statement Record Function Invoked');

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
    const { recordId, gathrData, hubspotRegion, accountNumberMap } = body;

    console.log('[REQUEST] Update request:', {
      recordId,
      statementCount: Array.isArray(gathrData) ? gathrData.length : 1,
      hubspotRegion,
      hasAccountNumberMap: !!accountNumberMap
    });

    // Validate required fields
    if (!recordId || !gathrData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required fields: recordId and gathrData are required'
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

    // Convert accountNumberMap from object to Map if provided
    const accountMap = accountNumberMap ? new Map(Object.entries(accountNumberMap)) : undefined;

    // Process statements (handle both single statement and array)
    const statements = Array.isArray(gathrData) ? gathrData : [gathrData];

    console.log('[PROCESS] Processing statement data:', {
      recordId,
      statementCount: statements.length,
      statements: statements.map(s => ({
        customerId: s.customer_id,
        bankAccountId: s.bank_account_id,
        gathrStatementId: s.id
      })),
      accountNumberMap: accountMap ? Array.from(accountMap.entries()) : null
    });

    // Collect all IDs from all statements
    const customerIds = [];
    const bankAccountIds = [];
    const gathrStatementIds = [];
    const accountNumbers = [];

    for (const statement of statements) {
      if (statement.customer_id) {
        customerIds.push(statement.customer_id);
      }
      if (statement.bank_account_id) {
        bankAccountIds.push(statement.bank_account_id);

        // Get account number from map if available
        if (accountMap && accountMap.has(statement.bank_account_id)) {
          const accountNumber = accountMap.get(statement.bank_account_id);
          if (accountNumber) {
            accountNumbers.push(accountNumber);
          }
        }
      }
      if (statement.id) {
        gathrStatementIds.push(statement.id);
      }
    }

    // Deduplicate customer_id, bank_account_id, and account_number
    const uniqueCustomerIds = Array.from(new Set(customerIds));
    const uniqueBankAccountIds = Array.from(new Set(bankAccountIds));
    const uniqueAccountNumbers = Array.from(new Set(accountNumbers));

    console.log('[PROCESS] ID deduplication:', {
      customerIds: {
        original: customerIds.length,
        unique: uniqueCustomerIds.length,
        removed: customerIds.length - uniqueCustomerIds.length
      },
      bankAccountIds: {
        original: bankAccountIds.length,
        unique: uniqueBankAccountIds.length,
        removed: bankAccountIds.length - uniqueBankAccountIds.length
      },
      accountNumbers: {
        original: accountNumbers.length,
        unique: uniqueAccountNumbers.length,
        removed: accountNumbers.length - uniqueAccountNumbers.length
      },
      gathrStatementIds: {
        total: gathrStatementIds.length,
        note: "All kept (unique per statement)"
      }
    });

    // Build properties object with semicolon-separated values (HubSpot multi-value format)
    const properties = {};

    if (uniqueCustomerIds.length > 0) {
      properties.customer_id = uniqueCustomerIds.join(';');
    }

    if (uniqueBankAccountIds.length > 0) {
      properties.bank_account_id = uniqueBankAccountIds.join(';');
    }

    if (uniqueAccountNumbers.length > 0) {
      properties.account_number = uniqueAccountNumbers.join(';');
    }

    if (gathrStatementIds.length > 0) {
      properties.gathr_statement_id = gathrStatementIds.join(';');
    }

    // Check if there are properties to update
    if (Object.keys(properties).length === 0) {
      console.log('[PROCESS] No Gathr fields to update');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No fields to update',
          recordId
        })
      };
    }

    // Determine object type ID and construct HubSpot API URL
    const GATHR_STATEMENT_OBJECT_TYPE_ID = "2-197849905";
    const region = hubspotRegion || 'https://api-eu1.hubapi.com';
    const hubspotUrl = `${region}/crm/v3/objects/${GATHR_STATEMENT_OBJECT_TYPE_ID}/${recordId}`;

    console.log('[HUBSPOT] Sending update request:', {
      url: hubspotUrl,
      method: "PATCH",
      objectTypeId: GATHR_STATEMENT_OBJECT_TYPE_ID,
      recordId,
      statementCount: statements.length,
      properties,
      propertyArrayLengths: {
        customerIds: uniqueCustomerIds.length,
        bankAccountIds: uniqueBankAccountIds.length,
        accountNumbers: uniqueAccountNumbers.length,
        gathrStatementIds: gathrStatementIds.length
      }
    });

    // Make the request to HubSpot
    let response = await fetch(hubspotUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ properties })
    });

    console.log('[HUBSPOT] Response received:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
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
          response = await fetch(hubspotUrl, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ properties })
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
      console.error('[ERROR] Failed to update statement record:', {
        status: response.status,
        statusText: response.statusText,
        responseBody,
        requestProperties: properties,
        note: response.status === 431 ?
          "Status 431 often indicates property doesn't exist in HubSpot. Please verify the custom properties (customer_id, bank_account_id, account_number, gathr_statement_id) are created in your HubSpot account." :
          null
      });

      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: 'Failed to update statement record',
          status: response.status,
          message: responseBody.message || response.statusText,
          details: responseBody
        })
      };
    }

    // Success!
    console.log('[OK] Statement record updated successfully:', {
      recordId,
      statementCount: statements.length,
      updatedProperties: properties,
      arrayLengths: {
        customerIds: uniqueCustomerIds.length,
        bankAccountIds: uniqueBankAccountIds.length,
        accountNumbers: uniqueAccountNumbers.length,
        gathrStatementIds: gathrStatementIds.length
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        recordId,
        statementCount: statements.length,
        updatedProperties: properties,
        response: responseBody
      })
    };

  } catch (error) {
    console.error('[ERROR] Error updating statement record:', error);
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

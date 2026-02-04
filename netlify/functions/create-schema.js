// Check for Gathr Statements Custom Object Schema
// This verifies the custom object exists during installation (does not create it)

const fetch = require('node-fetch');
const { getTokens, needsRefresh, saveTokens } = require('./token-store');

// Get the current access token (with auto-refresh)
// MULTI-TENANT: Requires hub_id to retrieve the correct portal's tokens
const getAccessToken = async (hub_id) => {
  console.log('[SCHEMA AUTH] Getting access token for portal:', hub_id);

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
  console.log('[SCHEMA REFRESH] Refreshing access token for portal:', hub_id);

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

  console.log('[OK] Token refreshed successfully for portal:', hub_id);

  const newTokenData = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || tokenToUse,
    expiresAt: Date.now() + (tokens.expires_in * 1000)
  };

  try {
    await saveTokens(hub_id, newTokenData);
    console.log('   [OK] New tokens saved to storage for portal:', hub_id);
  } catch (error) {
    console.error('   [WARN] Failed to save refreshed tokens:', error.message);
  }

  return newTokenData;
};

/**
 * Creates the Gathr Statements custom object schema in HubSpot
 * @param {string} hub_id - Portal ID
 * @param {string} region - HubSpot API region (default: api.hubapi.com)
 * @returns {Promise<Object>} The created schema object
 */
const createGathrStatementsSchema = async (hub_id, region = 'https://api.hubapi.com') => {
  console.log('[SCHEMA] Creating Gathr Statements custom object for portal:', hub_id);

  // Get access token for this portal
  const accessToken = await getAccessToken(hub_id);
  if (!accessToken) {
    throw new Error('No access token available for portal: ' + hub_id);
  }
  const schemaDefinition = {
    name: "gathr_statements",
    labels: {
      singular: "Gathr Statement",
      plural: "Gathr Statements"
    },
    primaryDisplayProperty: "statement_id",
    requiredProperties: ["statement_id"],
    searchableProperties: ["statement_id", "account_number", "gathr_statement_id"],
    properties: [
      {
        name: "statement_id",
        label: "Statement ID",
        type: "string",
        fieldType: "text",
        description: "Display name/identifier for the statement (e.g., bank name, account name)",
        hasUniqueValue: false
      },
      {
        name: "statement",
        label: "Statement File",
        type: "string",
        fieldType: "file",
        description: "The uploaded bank statement file",
        hasUniqueValue: false
      },
      {
        name: "account_number",
        label: "Account Number",
        type: "string",
        fieldType: "text",
        description: "Bank account number(s) - semicolon-separated for multiple accounts",
        hasUniqueValue: false
      },
      {
        name: "bank_account_id",
        label: "Bank Account ID",
        type: "string",
        fieldType: "text",
        description: "Gathr bank account ID(s) - semicolon-separated for multiple accounts",
        hasUniqueValue: false
      },
      {
        name: "customer_id",
        label: "Customer ID",
        type: "string",
        fieldType: "text",
        description: "Gathr customer ID(s) - semicolon-separated for multiple customers",
        hasUniqueValue: false
      },
      {
        name: "gathr_statement_id",
        label: "Gathr Statement ID",
        type: "string",
        fieldType: "text",
        description: "Gathr API statement ID(s) - semicolon-separated for multiple statements",
        hasUniqueValue: false
      }

    ],
    associatedObjects: ["CONTACT", "COMPANY"]
  };

  console.log('[SCHEMA] Schema definition prepared:', {
    name: schemaDefinition.name,
    propertyCount: schemaDefinition.properties.length,
    associations: schemaDefinition.associatedObjects
  });

  const response = await fetch(`${region}/crm/v3/schemas`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(schemaDefinition)
  });

  const responseBody = await response.json();

  if (!response.ok) {
    // If schema already exists, that's okay - just return the error info
    if (response.status === 409) {
      console.log('[SCHEMA] Schema already exists (409 conflict) - this is okay');
      console.log('   Existing schema:', responseBody);
      return {
        exists: true,
        schema: responseBody,
        objectTypeId: responseBody.objectTypeId
      };
    }

    // Check for missing scopes error
    if (response.status === 403 && responseBody.category === 'MISSING_SCOPES') {
      console.error('[SCHEMA] Missing required scopes for schema creation');
      console.error('   Required scopes: crm.schemas.custom.write, crm.schemas.custom.read');
      console.error('   Error:', responseBody.message);

      throw new Error(
        'Missing required OAuth scopes. Please reinstall the app with the following scopes: ' +
        'crm.schemas.custom.read, crm.schemas.custom.write, crm.objects.custom.read, crm.objects.custom.write'
      );
    }

    console.error('[SCHEMA] Failed to create schema:', {
      status: response.status,
      error: responseBody
    });

    throw new Error(`Failed to create schema: ${responseBody.message || response.statusText}`);
  }

  console.log('[SCHEMA] Successfully created custom object:', {
    objectTypeId: responseBody.objectTypeId,
    name: responseBody.name,
    fullyQualifiedName: responseBody.fullyQualifiedName
  });

  return {
    created: true,
    schema: responseBody,
    objectTypeId: responseBody.objectTypeId
  };
};

/**
 * Gets existing schema if it already exists
 * @param {string} hub_id - Portal ID
 * @param {string} region - HubSpot API region
 * @returns {Promise<Object|null>} Existing schema or null
 */
const getExistingSchema = async (hub_id, region = 'https://api.hubapi.com') => {
  console.log('[SCHEMA] Checking for existing Gathr Statements schema for portal:', hub_id);

  // Get access token for this portal
  const accessToken = await getAccessToken(hub_id);
  if (!accessToken) {
    console.error('[SCHEMA] No access token available for portal:', hub_id);
    return null;
  }

  try {
    const response = await fetch(`${region}/crm/v3/schemas`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('[SCHEMA] Failed to fetch schemas:', response.status);
      return null;
    }

    const data = await response.json();
    const existingSchema = data.results?.find(s =>
      s.name === 'gathr_statements' ||
      s.labels?.singular === 'Gathr Statement'
    );

    if (existingSchema) {
      console.log('[SCHEMA] Found existing schema:', {
        objectTypeId: existingSchema.objectTypeId,
        name: existingSchema.name
      });
      return existingSchema;
    }

    console.log('[SCHEMA] No existing schema found');
    return null;
  } catch (error) {
    console.error('[SCHEMA] Error checking for existing schema:', error.message);
    return null;
  }
};

/**
 * Checks if the Gathr Statements schema exists - does NOT create it
 * @param {string} hub_id - Portal ID
 * @param {string} region - HubSpot API region
 * @returns {Promise<Object>} Schema info with objectTypeId or warning if not found
 */
const ensureGathrStatementsSchema = async (hub_id, region = 'https://api.hubapi.com') => {
  // Check if schema already exists
  const existingSchema = await getExistingSchema(hub_id, region);

  if (existingSchema) {
    console.log('[SCHEMA] Found existing gathr_statements schema');
    return {
      exists: true,
      schema: existingSchema,
      objectTypeId: existingSchema.objectTypeId
    };
  }

  // Schema not found - return warning
  console.log('[SCHEMA] WARNING: gathr_statements schema not found');
  console.log('[SCHEMA] Customer needs to manually create the schema before using the app');
  return {
    exists: false,
    warning: 'gathr_statements custom object not found',
    message: 'Please create the gathr_statements custom object manually in HubSpot before using this app'
  };
};

/**
 * Gets the object type ID for the Gathr Statements schema
 * @param {string} hub_id - Portal ID
 * @param {string} region - HubSpot API region
 * @returns {Promise<string|null>} Object type ID or null if not found
 */
const getGathrStatementsObjectTypeId = async (hub_id, region = 'https://api.hubapi.com') => {
  const schema = await getExistingSchema(hub_id, region);
  return schema ? schema.objectTypeId : null;
};

module.exports = {
  createGathrStatementsSchema,
  getExistingSchema,
  ensureGathrStatementsSchema,
  getGathrStatementsObjectTypeId
};

// Check for Gathr Statements Custom Object Schema
// This verifies the custom object exists during installation (does not create it)

const fetch = require('node-fetch');

/**
 * Creates the Gathr Statements custom object schema in HubSpot
 * @param {string} accessToken - OAuth access token for the portal
 * @param {string} hub_id - Portal ID for logging
 * @param {string} region - HubSpot API region (default: api.hubapi.com)
 * @returns {Promise<Object>} The created schema object
 */
const createGathrStatementsSchema = async (accessToken, hub_id, region = 'https://api.hubapi.com') => {
  console.log('[SCHEMA] Creating Gathr Statements custom object for portal:', hub_id);

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
 * @param {string} accessToken - OAuth access token
 * @param {string} hub_id - Portal ID
 * @param {string} region - HubSpot API region
 * @returns {Promise<Object|null>} Existing schema or null
 */
const getExistingSchema = async (accessToken, hub_id, region = 'https://api.hubapi.com') => {
  console.log('[SCHEMA] Checking for existing Gathr Statements schema for portal:', hub_id);

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
 * @param {string} accessToken - OAuth access token
 * @param {string} hub_id - Portal ID
 * @param {string} region - HubSpot API region
 * @returns {Promise<Object>} Schema info with objectTypeId or warning if not found
 */
const ensureGathrStatementsSchema = async (accessToken, hub_id, region = 'https://api.hubapi.com') => {
  // Check if schema already exists
  const existingSchema = await getExistingSchema(accessToken, hub_id, region);

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
 * @param {string} accessToken - OAuth access token
 * @param {string} hub_id - Portal ID
 * @param {string} region - HubSpot API region
 * @returns {Promise<string|null>} Object type ID or null if not found
 */
const getGathrStatementsObjectTypeId = async (accessToken, hub_id, region = 'https://api.hubapi.com') => {
  const schema = await getExistingSchema(accessToken, hub_id, region);
  return schema ? schema.objectTypeId : null;
};

module.exports = {
  createGathrStatementsSchema,
  getExistingSchema,
  ensureGathrStatementsSchema,
  getGathrStatementsObjectTypeId
};

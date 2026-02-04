# HubSpot OAuth Server for Gathr App

This Netlify Functions-based OAuth server handles HubSpot authentication and API calls for the Gathr HubSpot card.

## Features

- **Multi-tenant architecture** - Each portal gets isolated tokens and schemas
- **Automatic schema creation** - "Gathr Statements" custom object created during installation
- OAuth 2.0 flow with HubSpot
- Automatic token refresh (portal-specific)
- Token storage (in-memory Map keyed by `hub_id`)
- Generic HubSpot API proxy
- Dedicated endpoints for statement records, file metadata, and schema management

## Multi-Tenant Architecture

Each HubSpot portal that installs your app gets:
- **Its own OAuth tokens** (access token + refresh token)
- **Its own custom objects** (e.g., `p147556974_gathr_statements`)
- **Its own schemas** (portal-specific object type IDs)
- **Isolated data** - no cross-portal contamination

### How It Works

```
Portal A (hub_id: 111) → tokens[111] → p111_gathr_statements
Portal B (hub_id: 222) → tokens[222] → p222_gathr_statements
Portal C (hub_id: 333) → tokens[333] → p333_gathr_statements
```

All API calls require `hub_id` to ensure proper token and schema isolation.

## Automatic Schema Creation

During OAuth installation, the "Gathr Statements" custom object is automatically created with:

### Properties
- `statement_id` (text) - Display name (e.g., bank name, account name)
- `statement` (file) - The uploaded statement file reference
- `account_number` (text) - Account number(s) - semicolon-separated
- `bank_account_id` (text) - Bank account ID(s) - semicolon-separated
- `customer_id` (text) - Customer ID(s) - semicolon-separated
- `gathr_statement_id` (text) - Gathr API statement ID(s) - semicolon-separated

### Associations
- Automatically associated with **Contacts**
- Automatically associated with **Companies**

### If Schema Creation Fails

If you see "Schema creation failed - missing scopes" during installation:

**Option 1: Reinstall with correct scopes**
1. Uninstall the app from HubSpot
2. Ensure the `SCOPE` environment variable includes `crm.schemas.custom.write`
3. Reinstall via `/install` endpoint
4. Authorize the new permissions

**Option 2: Manually create the schema**
1. Go to HubSpot Settings → Data Management → Objects
2. Click "Create custom object"
3. Name: "Gathr Statements"
4. Singular label: "Gathr Statement"
5. Plural label: "Gathr Statements"
6. Add the properties listed above
7. Associate with Contacts and Companies
8. Save

### Example Record
```json
{
  "id": "385766738119",
  "statementId": "Capitec Multiple Accounts",
  "hasFile": true,
  "gathrStatementId": "152c6fd3-3d0a-4553-b829-6edf3e2ace17;047a9261-bc7e-4299-898a-7ab5c846c697",
  "bankAccountId": "f589a642-e88c-46d8-8e91-687c791c9c70;197d622d-04af-4016-b0ea-e88557be51fd",
  "accountNumber": "1234567890;9876543210"
}
```

## Getting the `hub_id`

The `hub_id` (portal ID) is required for all API calls. You can get it from:

1. **OAuth callback response** - HubSpot includes it in the token response
2. **HubSpot extension context** - Available in CRM cards/extensions
3. **Frontend storage** - Store it after OAuth completion

### Example: Getting hub_id in HubSpot Extension

```javascript
// In your HubSpot CRM card
const context = await window.CRM.getContext();
const hub_id = context.portal.id;
```

## Using `hub_id` in API Calls

### For POST Endpoints (Request Body)
```json
{
  "hub_id": "123456",
  "recordId": "...",
  "gathrData": [...]
}
```

### For Proxy Endpoint (Header)
```javascript
headers: {
  "X-Hub-Id": "123456",
  "X-Requested-Path": "/crm/v3/objects/contacts",
  "X-HubSpot-Region": "https://api-eu1.hubapi.com"
}
```

## Endpoints

### 1. `/oauth-start`
Initiates the OAuth flow by redirecting to HubSpot's authorization page.

**Method:** GET  
**Usage:** Visit this URL to start authentication

### 2. `/oauth-callback`
Handles the OAuth callback from HubSpot and exchanges the authorization code for tokens.

**Method:** GET (called by HubSpot)  
**Returns:** Success page with tokens for manual setup

### 3. `/install`
Alternative installation endpoint (legacy).

### 4. `/hubspot-proxy`
Generic proxy for any HubSpot API call. Automatically attaches the stored OAuth token for the specified portal.

**Method:** GET, POST, PATCH, PUT, DELETE
**Headers Required:**
- `X-Hub-Id`: Portal ID (required for multi-tenant)
- `X-Requested-Path`: HubSpot API path (e.g., `/crm/v3/objects/contacts`)
- `X-HubSpot-Region`: HubSpot API region (e.g., `https://api-eu1.hubapi.com`)

**Example Client Code:**
```javascript
const response = await fetch('https://hs-gathr-oauth.netlify.app/.netlify/functions/hubspot-proxy', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    'X-Hub-Id': '123456',
    'X-Requested-Path': '/crm/v3/objects/contacts',
    'X-HubSpot-Region': 'https://api-eu1.hubapi.com'
  }
});
```

---

## Dedicated Endpoints (Business Logic on Server)

### 5. `/update-statement-record`
**Dedicated endpoint for updating Gathr statement records in HubSpot.**

This endpoint centralizes the business logic for updating statement records, including:
- Processing multiple statements at once
- Deduplicating IDs (customer_id, bank_account_id, account_number)
- Building semicolon-separated multi-value properties
- Making the HubSpot API call with the stored OAuth token

**Method:** POST  
**Content-Type:** `application/json`

**Request Body:**
```json
{
  "hub_id": "123456",
  "recordId": "12345",
  "gathrData": [
    {
      "id": "stmt_123",
      "customer_id": "cust_456",
      "bank_account_id": "ba_789",
      "transaction_count": 42
    }
  ],
  "hubspotRegion": "https://api-eu1.hubapi.com",
  "accountNumberMap": {
    "ba_789": "1234567890"
  }
}
```

**Response (Success):**
```json
{
  "success": true,
  "recordId": "12345",
  "statementCount": 1,
  "updatedProperties": {
    "customer_id": "cust_456",
    "bank_account_id": "ba_789",
    "account_number": "1234567890",
    "gathr_statement_id": "stmt_123"
  },
  "response": { /* HubSpot API response */ }
}
```

**Client Code Example:**
```javascript
import { hubspot } from "@hubspot/ui-extensions";

const response = await hubspot.fetch(
  "https://hs-gathr-oauth.netlify.app/.netlify/functions/update-statement-record",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      recordId: "12345",
      gathrData: statements,
      hubspotRegion: "https://api-eu1.hubapi.com",
      accountNumberMap: Object.fromEntries(accountNumberMap),
    },
  }
);
```

### 6. `/get-file-metadata`

**Dedicated endpoint for fetching HubSpot file metadata.**

This endpoint fetches file metadata from the HubSpot Files API with automatic token management.

**Method:** POST  
**Content-Type:** `application/json`

**Request Body:**
```json
{
  "hub_id": "123456",
  "fileId": "12345",
  "hubspotRegion": "https://api-eu1.hubapi.com"
}
```

**Response (Success):**
```json
{
  "success": true,
  "fileId": "12345",
  "metadata": {
    "url": "https://...",
    "name": "statement.pdf",
    "size": 123456,
    "type": "PDF",
    "extension": "pdf"
  },
  "duration": 145
}
```

**Client Code Example:**
```javascript
import { hubspot } from "@hubspot/ui-extensions";

const response = await hubspot.fetch(
  "https://hs-gathr-oauth.netlify.app/.netlify/functions/get-file-metadata",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      fileId: "12345",
      hubspotRegion: "https://api-eu1.hubapi.com",
    },
  }
);
```

### 7. `/create-statement-record`

**Dedicated endpoint for creating and associating statement records.**

This endpoint creates a new Gathr statement record in HubSpot and associates it with a contact or company.

**Method:** POST  
**Content-Type:** `application/json`

**Request Body:**
```json
{
  "hub_id": "123456",
  "statementId": "STMT-2024-001",
  "currentObjectTypeId": "0-1",
  "currentRecordId": "12345",
  "hubspotRegion": "https://api-eu1.hubapi.com"
}
```

**Response (Success):**
```json
{
  "success": true,
  "recordId": "67890",
  "statementId": "STMT-2024-001",
  "message": "Statement record created and associated successfully"
}
```

**Client Code Example:**
```javascript
import { hubspot } from "@hubspot/ui-extensions";

const response = await hubspot.fetch(
  "https://hs-gathr-oauth.netlify.app/.netlify/functions/create-statement-record",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      statementId: "STMT-2024-001",
      currentObjectTypeId: "0-1",
      currentRecordId: "12345",
      hubspotRegion: "https://api-eu1.hubapi.com",
    },
  }
);
```

---

## Setup

### Environment Variables

Required:
- `CLIENT_ID` - Your HubSpot app client ID
- `CLIENT_SECRET` - Your HubSpot app client secret
- `REDIRECT_URI` - OAuth callback URL (default: `{URL}/oauth-callback`)

Optional (for persistent token storage):
- `HUBSPOT_ACCESS_TOKEN` - HubSpot access token
- `HUBSPOT_REFRESH_TOKEN` - HubSpot refresh token
- `HUBSPOT_TOKEN_EXPIRES_AT` - Token expiry timestamp
- `HUBSPOT_PORTAL_ID` - Portal ID (for single-tenant dev/test only)

### Required OAuth Scopes

The `SCOPE` environment variable should include these scopes (space or comma-separated):

**Required for automatic schema creation:**
```
crm.schemas.custom.read
crm.schemas.custom.write
crm.objects.custom.read
crm.objects.custom.write
```

**Required for app functionality:**
```
crm.objects.contacts.read
crm.objects.contacts.write
crm.objects.companies.read
crm.objects.companies.write
files
```

**Full scope string:**
```bash
SCOPE="crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read crm.objects.companies.write crm.schemas.custom.read crm.schemas.custom.write crm.objects.custom.read crm.objects.custom.write files"
```

Or comma-separated:
```bash
SCOPE="crm.objects.contacts.read,crm.objects.contacts.write,crm.objects.companies.read,crm.objects.companies.write,crm.schemas.custom.read,crm.schemas.custom.write,crm.objects.custom.read,crm.objects.custom.write,files"
```

**If SCOPE is not set**, the app uses the default scopes listed above.

**Important:** Without `crm.schemas.custom.write` scope, automatic schema creation will fail during installation. You can either:
1. Set the correct scopes and reinstall the app
2. Manually create the "Gathr Statements" custom object in HubSpot

### Initial Authentication

1. Visit: `https://hs-gathr-oauth.netlify.app/.netlify/functions/oauth-start`
2. Authorize the app in HubSpot
3. Copy the tokens from the success page
4. Add them to Netlify environment variables:
   - `HUBSPOT_ACCESS_TOKEN`
   - `HUBSPOT_REFRESH_TOKEN`
5. Redeploy the site

### Token Storage

The server uses a two-tier storage approach:

1. **Environment Variables** (persistent, recommended for production)
   - Tokens are read from `HUBSPOT_ACCESS_TOKEN` and `HUBSPOT_REFRESH_TOKEN`
   - Survives server restarts
   - Must be manually set in Netlify dashboard

2. **Memory Cache** (temporary, 10 minutes)
   - Used for immediate testing after OAuth flow
   - Automatically cleared on server restart
   - Falls back to environment variables

### Token Refresh

Tokens are automatically refreshed when:
- They expire (or within 5 minutes of expiry)
- A 401 response is received from HubSpot
- The refresh token is available

New tokens are saved back to the cache and logged for manual environment variable updates.

## Architecture

```
Client (HubSpot Card)
    ↓
    ├─→ /update-statement-record (POST with data)
    │       ↓
    │   [Business Logic on Server]
    │   - Deduplicate IDs
    │   - Build properties
    │       ↓
    │   [HubSpot API Call]
    │   - Uses stored OAuth token
    │   - Auto-refreshes if needed
    │       ↓
    │   [Returns result to client]
    │
    └─→ /hubspot-proxy (Generic proxy)
            ↓
        [Direct pass-through to HubSpot API]
        - Attaches OAuth token
        - Auto-refreshes if needed
```

## Security

**OAuth tokens never exposed to client**
- Tokens stored on server (environment variables or memory)
- Client makes requests to proxy/dedicated endpoints
- Server attaches tokens server-side

**CORS enabled for your domains**
- Configured for HubSpot card origin
- Safe for public endpoints

**Client secret protected**
- Never sent to client
- Used only server-side for token refresh

## Benefits of Dedicated Endpoint

The `/update-statement-record` endpoint provides several advantages over the generic proxy:

1. **Centralized Business Logic** - All deduplication and processing happens server-side
2. **Simpler Client Code** - Client just sends raw data, server handles complexity
3. **Type Safety** - Server validates data structure
4. **Better Logging** - Detailed server-side logs for debugging
5. **Easier Testing** - Test business logic independently
6. **Security** - Sensitive operations performed server-side

## Deployment

This is deployed on Netlify Functions:

```bash
# Deploy to Netlify
git push origin main

# Netlify automatically deploys from git
```

## Troubleshooting

### No access token available
- Run the OAuth flow: `/oauth-start`
- Add tokens to environment variables
- Check Netlify function logs

### Token expired
- Tokens auto-refresh if `HUBSPOT_REFRESH_TOKEN` is set
- Otherwise, run OAuth flow again

### 431 status from HubSpot
- Custom properties don't exist in HubSpot
- Verify properties exist: `customer_id`, `bank_account_id`, `account_number`, `gathr_statement_id`

## Development

Local development with Netlify CLI:

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Run locally
netlify dev

# Test OAuth flow
open http://localhost:8888/.netlify/functions/oauth-start
```

## File Structure

```
netlify/functions/
├── hubspot-proxy.js            # Generic HubSpot API proxy
├── update-statement-record.js  # Dedicated statement update endpoint
├── get-file-metadata.js        # Dedicated file metadata endpoint
├── create-statement-record.js  # Dedicated record creation endpoint
├── oauth-start.js              # Start OAuth flow
├── oauth-callback.js           # Handle OAuth callback
├── install.js                  # Legacy install endpoint
└── token-store.js              # Token storage utilities
```

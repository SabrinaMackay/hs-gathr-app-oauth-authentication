# Changelog

## 2026-02-04 - Schema Verification (No Automatic Creation)

### Breaking Change: Removed Automatic Schema Creation

**Problem:** The `crm.schemas.custom.write` OAuth scope does not exist in HubSpot's API. The app was requesting an invalid scope that would fail during OAuth installation.

**Solution:** Changed from automatic schema creation to schema verification. The app now checks if the `gathr_statements` custom object exists and provides setup instructions if it doesn't.

### Changes

**Updated:** `netlify/functions/install.js`
- Removed invalid `crm.schemas.custom.write` scope from default scopes
- Updated scope comment to clarify `crm.schemas.custom.read` is view-only

**Updated:** `netlify/functions/create-schema.js`
- Renamed from "Create" to "Check" functionality
- `ensureGathrStatementsSchema()` now only checks for existing schema (does not create)
- Returns warning object if schema not found: `{ exists: false, warning: '...', message: '...' }`
- Installation proceeds successfully even if schema doesn't exist

**Updated:** `netlify/functions/oauth-callback.js`
- Changed from "Creating" to "Checking" for Gathr Statements schema
- Updated success page to show schema verification status
- Added detailed warning section with manual setup instructions if schema not found
- Removed scope error handling (no longer trying to create schemas)
- Installation always succeeds, but warns user if manual setup is needed

**Updated:** `README.md`
- Changed "Automatic Schema Creation" section to "Gathr Statements Custom Object Setup"
- Moved manual creation instructions to primary documentation (no longer an "if fails" option)
- Removed `crm.schemas.custom.write` from required scopes list
- Updated all scope strings and examples
- Added note that Enterprise account is required for custom objects
- Clarified that installation will proceed with warning if schema doesn't exist

### Required OAuth Scopes (Updated)

```bash
SCOPE="crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read crm.objects.companies.write crm.schemas.custom.read crm.objects.custom.read crm.objects.custom.write files"
```

**Removed:**
- `crm.schemas.custom.write` (does not exist in HubSpot API)

**Kept:**
- `crm.schemas.custom.read` (for schema verification)
- `crm.objects.custom.read` / `crm.objects.custom.write` (for working with custom object records)

### Manual Schema Setup Required

Customers must now manually create the `gathr_statements` custom object in HubSpot:

1. Go to Settings → Data Management → Objects
2. Create custom object named `gathr_statements`
3. Add required properties (statement_id, statement, account_number, etc.)
4. Associate with Contacts and Companies

**Note:** Requires HubSpot Enterprise account.

### Migration for Existing Installations

If you previously installed with the invalid `crm.schemas.custom.write` scope:
1. No action needed if schema already exists
2. If schema doesn't exist, follow manual setup instructions above
3. Reinstalling the app is optional (it will now request correct scopes)

---

## 2026-02-04 - Multi-Tenant Support & Automatic Schema Creation

### Update: Required OAuth Scopes

**Problem:** Schema creation was failing with 403 error due to missing OAuth scopes.

**Solution:** Updated default scopes to include custom object permissions.

**Updated:** `netlify/functions/install.js`
- Added default scopes array with all required permissions
- `crm.schemas.custom.read` - Read custom object schemas
- `crm.schemas.custom.write` - **Create/modify custom objects (REQUIRED)**
- `crm.objects.custom.read` - Read custom object records
- `crm.objects.custom.write` - Write custom object records
- `files` - Access files API
- Contact and company read/write permissions

**Updated:** `netlify/functions/create-schema.js`
- Better error handling for 403 scope errors
- Clear error message indicating missing scopes
- Suggests which scopes are needed

**Updated:** `netlify/functions/oauth-callback.js`
- Captures schema creation error details
- Shows user-friendly error message on success page
- Provides reinstallation instructions if scopes are missing
- Option to manually create schema if needed

**How to Fix:**
1. **Netlify Environment Variable:**
   ```bash
   SCOPE="crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read crm.objects.companies.write crm.schemas.custom.read crm.schemas.custom.write crm.objects.custom.read crm.objects.custom.write files"
   ```

2. **Or uninstall and reinstall** - the app will now request the correct scopes by default

**Breaking Change for Existing Installations:**
- Existing installations without schema creation scopes will need to:
  - Reinstall the app with updated scopes, OR
  - Manually create the "Gathr Statements" custom object in HubSpot

---

## 2026-02-04 - Multi-Tenant Support & Automatic Schema Creation

### Critical Bug Fix: Multi-Tenant Token Isolation

**Problem:** Tokens were stored globally, causing all portals to share the same OAuth token. This meant:
- Portal A installs → creates schemas in Portal A
- Portal B installs → overwrites Portal A's token
- Portal A now uses Portal B's token → creates schemas in Portal B
- Result: All schemas ended up in one portal (e.g., `p147556974_*`)

**Solution:** Portal-specific token storage keyed by `hub_id`

#### Changes

**Updated:** `netlify/functions/token-store.js`
- Changed from global `cachedTokens` to `Map<hub_id, tokens>`
- `saveTokens(hub_id, tokens)` - now requires portal ID
- `getTokens(hub_id)` - retrieves portal-specific tokens
- Logs available portals for debugging

**Updated:** `netlify/functions/oauth-callback.js`
- Extracts `hub_id` from HubSpot token response
- Passes `hub_id` to `saveTokens()`
- Shows portal ID in success page
- Validates `hub_id` exists in response

**Updated:** All API Endpoints (6 files)
- `get-object-schema.js` - requires `hub_id` in request body
- `hubspot-proxy.js` - requires `X-Hub-Id` header
- `create-statement-record.js` - requires `hub_id` in request body
- `update-statement-record.js` - requires `hub_id` in request body
- `get-file-metadata.js` - requires `hub_id` in request body
- All token operations now portal-scoped

### New Feature: Automatic Schema Creation

**New File:** `netlify/functions/create-schema.js`
- Creates "Gathr Statements" custom object during installation
- Defines schema with 7 properties:
  - `statement_id` (text) - Display name
  - `has_file` (boolean) - File upload status
  - `gathr_statement_id` (text) - Gathr API ID(s)
  - `bank_account_id` (text) - Bank account ID(s)
  - `customer_id` (text) - Customer ID(s)
  - `account_number` (text) - Account number(s)
  - `statement_file` (file) - Uploaded file reference
- Auto-associates with Contacts and Companies
- Handles existing schemas gracefully (409 conflict)
- Portal-specific schema creation

**Functions:**
- `createGathrStatementsSchema()` - Creates the schema
- `getExistingSchema()` - Checks if schema exists
- `ensureGathrStatementsSchema()` - Creates or returns existing
- `getGathrStatementsObjectTypeId()` - Looks up object type ID

**Updated:** `netlify/functions/oauth-callback.js`
- Calls `ensureGathrStatementsSchema()` after OAuth success
- Shows schema creation status on success page
- Doesn't fail OAuth if schema creation fails (can retry later)
- Displays object type ID and properties on success page

**Updated:** `netlify/functions/create-statement-record.js`
- Removed hardcoded `GATHR_STATEMENT_OBJECT_TYPE_ID`
- Dynamically looks up object type ID per portal
- Returns 404 if schema doesn't exist
- Portal-specific object type IDs

**Updated:** `netlify/functions/update-statement-record.js`
- Removed hardcoded `GATHR_STATEMENT_OBJECT_TYPE_ID`
- Dynamically looks up object type ID per portal
- Returns 404 if schema doesn't exist
- Portal-specific object type IDs

### How Multi-Tenant Works Now

```
Portal A (111) installs → OAuth → tokens[111] = token-A → schema: p111_gathr_statements
Portal B (222) installs → OAuth → tokens[222] = token-B → schema: p222_gathr_statements
Portal C (333) installs → OAuth → tokens[333] = token-C → schema: p333_gathr_statements

API call with hub_id=111 → uses token-A → creates records in p111_gathr_statements
API call with hub_id=222 → uses token-B → creates records in p222_gathr_statements
API call with hub_id=333 → uses token-C → creates records in p333_gathr_statements
```

### Frontend Changes Required

All API calls must now include `hub_id`:

**For POST endpoints (body):**
```json
{
  "hub_id": "123456",
  "recordId": "...",
  "gathrData": [...]
}
```

**For proxy endpoint (header):**
```javascript
headers: {
  "X-Hub-Id": "123456",
  "X-Requested-Path": "/crm/v3/objects/contacts"
}
```

**Getting the hub_id:**
- Available in OAuth callback response
- Available in HubSpot extension context
- Store in frontend after OAuth completes

### Production Recommendations

**In-memory storage is NOT production-ready**

For production, replace the Map with a database:

```javascript
// Example with Redis
const saveTokens = async (hub_id, tokens) => {
  await redis.set(`tokens:${hub_id}`, JSON.stringify(tokens));
};

const getTokens = async (hub_id) => {
  const data = await redis.get(`tokens:${hub_id}`);
  return JSON.parse(data);
};
```

Recommended databases:
- Redis (fast, simple)
- DynamoDB (AWS, scalable)
- PostgreSQL (relational)
- MongoDB (document store)

### Testing

1. **Install in Portal A:**
   ```
   Visit: https://your-app.netlify.app/.netlify/functions/install
   Complete OAuth → Check logs for schema creation
   ```

2. **Install in Portal B:**
   ```
   Visit: https://your-app.netlify.app/.netlify/functions/install
   Complete OAuth → Should get different object type ID
   ```

3. **Verify Isolation:**
   ```bash
   # Call with Portal A's hub_id
   curl -X POST https://your-app.netlify.app/.netlify/functions/get-object-schema \
     -H "Content-Type: application/json" \
     -d '{"hub_id": "111", "hubspotRegion": "https://api.hubapi.com"}'

   # Should only see Portal A's schemas
   ```

### Breaking Changes

**Breaking change for existing deployments:**
- All API endpoints now require `hub_id` parameter
- Frontend must be updated to include `hub_id` in all requests
- Existing cached tokens in environment variables will still work for single-tenant dev/test

### Migration Guide

1. Update frontend to include `hub_id` in all API calls
2. Get `hub_id` from HubSpot context or OAuth response
3. Test with multiple portals to verify isolation
4. Set up production database for token storage
5. Update environment variable fallback (optional, for dev/test)

---

## 2026-02-03 - Added Dedicated Server Endpoints

### New Features: Three Dedicated Endpoints

Added three dedicated server-side endpoints for HubSpot API operations. This centralizes business logic on the OAuth server where tokens are securely stored.

#### 1. `/update-statement-record`
Updates HubSpot statement records with Gathr data

#### 2. `/get-file-metadata`
Fetches file metadata from HubSpot Files API

#### 3. `/create-statement-record`
Creates and associates new statement records

### Changes

#### Server-Side (OAuth Server)

**New File:** `netlify/functions/update-statement-record.js`
- Handles POST requests to update statement records
- Processes multiple statements at once
- Deduplicates IDs (customer_id, bank_account_id, account_number)
- Builds semicolon-separated multi-value properties (HubSpot format)
- Makes authenticated HubSpot API calls using stored OAuth token
- Auto-refreshes tokens when needed
- Returns detailed success/error responses

**New File:** `netlify/functions/get-file-metadata.js`
- Handles POST requests to fetch HubSpot file metadata
- Fetches from HubSpot Files API (/files/v3/files/{fileId})
- Returns file URL, name, size, type, and extension
- Auto-refreshes tokens when needed
- Comprehensive error handling and logging

**New File:** `netlify/functions/create-statement-record.js`
- Handles POST requests to create and associate statement records
- Creates new statement record in HubSpot
- Automatically associates record with contact/company
- Two-step process handled server-side
- Auto-refreshes tokens when needed
- Returns new record ID and success status

**Updated:** `README.md`
- Added comprehensive documentation for all endpoints
- Detailed API reference for all three new endpoints
- Architecture diagrams
- Setup and troubleshooting guides
- Updated file structure

**Updated:** `CHANGELOG.md`
- Detailed change log for all three endpoints
- Migration guides and examples

#### Client-Side (Gathr Card)

**Updated:** `src/app/cards/apiService.ts`

1. `updateStatementRecord` function
   - Simplified from ~185 lines to ~70 lines
   - Now calls dedicated server endpoint
   - Converts Map to plain object for JSON serialization
   - Better error handling and logging

2. `fetchHubSpotFileMetadata` function
   - Simplified from ~48 lines to ~35 lines
   - Now calls dedicated server endpoint
   - Cleaner response handling

3. `createAndAssociateRecord` function
   - Simplified from ~56 lines to ~33 lines
   - Now calls dedicated server endpoint
   - Single API call instead of two separate calls
   - Server handles the two-step process

### Benefits

1. **Security**: OAuth token never leaves the server - all three endpoints handle authentication server-side
2. **Maintainability**: Business logic centralized in one place for all HubSpot operations
3. **Simplicity**: Client code reduced by ~176 lines total across all three functions
4. **Reliability**: Server-side processing is more reliable for complex operations
5. **Debugging**: Better logging on server side for all API interactions
6. **Testing**: Easier to test business logic independently
7. **Performance**: Reduced round-trips for multi-step operations (create + associate)
8. **Consistency**: All HubSpot API calls follow the same pattern

### API Reference

#### 1. Update Statement Record

**Endpoint:**
```
POST https://hs-gathr-oauth.netlify.app/.netlify/functions/update-statement-record
```

**Request Body:**
```json
{
  "hub_id": "123456",
  "recordId": "12345",
  "gathrData": [
    {
      "id": "stmt_123",
      "customer_id": "cust_456",
      "bank_account_id": "ba_789"
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
  }
}
```

#### 2. Get File Metadata

**Endpoint:**
```
POST https://hs-gathr-oauth.netlify.app/.netlify/functions/get-file-metadata
```

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

#### 3. Create Statement Record

**Endpoint:**
```
POST https://hs-gathr-oauth.netlify.app/.netlify/functions/create-statement-record
```

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

#### Error Response (All Endpoints)

```json
{
  "error": "Error description",
  "status": 400,
  "message": "Detailed error message",
  "details": { /* Additional error info */ }
}
```

### Backwards Compatibility

✅ **Fully backwards compatible**
- Client-side API signature unchanged
- Same function parameters
- Same behavior from caller's perspective
- Implementation detail changed from client-side to server-side

### Migration Path

No migration needed! The change is transparent:

1. Deploy new server function to Netlify
2. Client code automatically uses new endpoint (already updated)
3. No changes to calling code in `GathrCard.tsx`

### Testing

To test the new endpoint:

1. **Check OAuth server logs** in Netlify dashboard
2. **Test with curl:**
   ```bash
   curl -X POST https://hs-gathr-oauth.netlify.app/.netlify/functions/update-statement-record \
     -H "Content-Type: application/json" \
     -d '{
       "recordId": "12345",
       "gathrData": [{"id": "stmt_1", "customer_id": "cust_1"}],
       "hubspotRegion": "https://api-eu1.hubapi.com"
     }'
   ```
3. **Use in Gathr card** - works automatically with existing code

### Deployment

1. Push to GitHub:
   ```bash
   cd /Users/sabrinamackay/dev/hs-gathr-app-oauth-authentication
   git add netlify/functions/*.js README.md CHANGELOG.md
   git commit -m "Add three dedicated HubSpot API endpoints"
   git push
   ```

2. Netlify auto-deploys from git

3. Verify in Netlify dashboard:
   - Functions → All three new functions should appear:
     - `update-statement-record`
     - `get-file-metadata`
     - `create-statement-record`
   - Check function logs for any errors
   - Test each endpoint individually

### Rollback Plan

If issues arise, you can temporarily revert the client code:

1. In `apiService.ts`, restore the original `updateStatementRecord` function
2. The old code will use the generic `callHubSpotAPI` proxy instead
3. Both approaches work - new endpoint is just better architecture

---

## Previous Updates

### 2026-02-03 - Modularized Gathr Card Code

Refactored `GathrCard.tsx` from 1993 lines into modular structure:
- Created `types.ts`, `constants.ts`, `utils.ts`, `apiService.ts`
- Created 5 component modules in `components/` folder
- Improved maintainability and readability
- Added comprehensive documentation

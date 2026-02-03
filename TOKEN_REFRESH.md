# Automatic Token Refresh Explained

## How It Works Now (With Netlify Blobs)

### Architecture

```
┌──────────────────┐
│   OAuth Flow     │
│  (one-time)      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Netlify Blobs   │ ← Persistent storage
│                  │
│  - access_token  │
│  - refresh_token │
│  - expires_at    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Proxy Function  │
│                  │
│  1. Load tokens  │
│  2. Check expiry │
│  3. Auto-refresh │
│  4. Save new     │
└──────────────────┘
```

### The Flow

1. **Initial OAuth** (one time):
   - User visits `/oauth-start`
   - Authorizes app in HubSpot
   - Callback receives tokens
   - **Tokens saved to Netlify Blobs** ← Persistent!

2. **Every API Request**:
   - Proxy loads tokens from Netlify Blobs
   - Checks if token expires soon (< 5 minutes)
   - If expiring → Auto-refreshes → Saves new token
   - Uses fresh token for API call

3. **When Token Expires**:
   - Next request detects expired token
   - Automatically refreshes using refresh token
   - Saves new access token to Netlify Blobs
   - All future requests use the new token

### What Happens on Token Refresh?

**Old Approach (Environment Variables):**
```
Request 1: Use token from env var
  ↓ Token expires
Request 2: Refresh → New token only in memory
Request 3: Use OLD token from env var again 😞
```

**New Approach (Netlify Blobs):**
```
Request 1: Load token from Blobs → Use it
  ↓ Token expires
Request 2: Detect expiry → Refresh → Save to Blobs
Request 3: Load FRESH token from Blobs → Use it ✅
Request 4: Load FRESH token from Blobs → Use it ✅
```

### When Someone Re-runs OAuth

**Old Approach:**
- New tokens generated
- Manual: Copy/paste into Netlify env vars
- Manual: Trigger new deploy
- Tokens finally work

**New Approach:**
- New tokens generated
- **Automatically** saved to Netlify Blobs
- **Immediately** available to proxy function
- **No** manual steps needed! ✅

## Benefits

✅ **Automatic**: Tokens refresh without manual intervention
✅ **Persistent**: Refreshed tokens survive across function invocations  
✅ **Seamless**: Re-running OAuth automatically updates stored tokens
✅ **Production-Ready**: No environment variable limitations
✅ **Efficient**: Only refreshes when needed (< 5 min before expiry)

## Fallback

If Netlify Blobs isn't available, the proxy falls back to:
1. Environment variables (`HUBSPOT_ACCESS_TOKEN`)
2. Manual token refresh on each 401 error

## Setup Requirements

### Dependencies
```bash
npm install @netlify/blobs
```

### Environment Variables (Still Needed)
```
CLIENT_ID=your_hubspot_client_id
CLIENT_SECRET=your_hubspot_client_secret
```

These are used for token refresh, NOT for storing tokens.

## Monitoring

### Check Token Status

The proxy logs show:
- ✅ When tokens are loaded from Blobs
- 🔄 When tokens are being refreshed
- ⏰ Token expiry time
- ✅ When new tokens are saved

### View Stored Tokens (Debugging)

In Netlify:
1. Go to your site
2. Click **Blobs** tab (if available in your plan)
3. Look for the `oauth-tokens` store

Or via Netlify CLI:
```bash
netlify blobs:list
netlify blobs:get oauth-tokens hubspot_tokens
```

## Comparison: Before vs After

| Feature | Environment Variables | Netlify Blobs |
|---------|----------------------|---------------|
| Token Refresh | Manual or temporary | Automatic & persistent |
| Re-OAuth | Manual env var update | Automatic update |
| Deploy Required | Yes | No |
| Production Ready | Limited | Yes ✅ |
| Multi-User | One set of tokens | Can extend to per-user |

## Future: Multi-User Support

To support multiple HubSpot accounts:
1. Store tokens keyed by HubSpot account ID
2. Accept account ID in request headers
3. Load/save tokens per account

Example:
```javascript
// Instead of:
await store.set('hubspot_tokens', tokenData);

// Use:
await store.set(`hubspot_tokens_${accountId}`, tokenData);
```

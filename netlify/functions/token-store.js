// Token storage - Multi-tenant token storage by hub_id
// For production, consider using a proper database like Redis or DynamoDB

// In-memory cache to avoid parsing JSON on every request
// Changed to Map for multi-tenant support: hub_id -> tokenData
const cachedTokens = new Map();
const CACHE_TTL = 60000; // 1 minute cache

// Save tokens to environment variable simulation (for demo)
// In production, this would write to a database keyed by hub_id
const saveTokens = async (hub_id, tokens) => {
  if (!hub_id) {
    throw new Error('[STORE] hub_id is required for saving tokens');
  }

  const tokenData = {
    hub_id: hub_id,
    accessToken: tokens.accessToken || tokens.access_token,
    refreshToken: tokens.refreshToken || tokens.refresh_token,
    expiresAt: tokens.expiresAt || (Date.now() + ((tokens.expires_in || 21600) * 1000)),
    updatedAt: Date.now()
  };

  console.log('[STORE] Saving tokens for portal:', hub_id);
  console.log('   Access token (first 10 chars):', tokenData.accessToken.substring(0, 10) + '...');
  console.log('   Expires at:', new Date(tokenData.expiresAt).toISOString());

  // Cache the tokens in memory, keyed by hub_id
  cachedTokens.set(hub_id, tokenData);

  console.log('[WARN] NOTE: Tokens are cached in memory only (multi-tenant)');
  console.log('   For production, store tokens in a database keyed by hub_id');
  console.log('   Currently storing tokens for', cachedTokens.size, 'portal(s)');

  return tokenData;
};

// Get current tokens from environment variables or cache
// For multi-tenant apps, hub_id is required to retrieve the correct tokens
const getTokens = async (hub_id) => {
  // Multi-tenant: Check cache first for hub-specific tokens
  if (hub_id) {
    const tokens = cachedTokens.get(hub_id);

    if (tokens) {
      console.log('[OK] Tokens loaded from cache for portal:', hub_id);
      console.log('   Cached:', Math.round((Date.now() - tokens.updatedAt) / 1000), 'seconds ago');
      return tokens;
    }

    // Check if environment variables match this hub_id (single-tenant fallback)
    if (process.env.HUBSPOT_ACCESS_TOKEN && process.env.HUBSPOT_REFRESH_TOKEN) {
      const envPortalId = process.env.HUBSPOT_PORTAL_ID || 'env-var-portal';

      // Only return env tokens if they match the requested hub_id
      if (envPortalId === hub_id || envPortalId === 'env-var-portal') {
        const tokens = {
          hub_id: envPortalId,
          accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
          refreshToken: process.env.HUBSPOT_REFRESH_TOKEN,
          expiresAt: process.env.HUBSPOT_TOKEN_EXPIRES_AT
            ? parseInt(process.env.HUBSPOT_TOKEN_EXPIRES_AT)
            : Date.now() + (6 * 60 * 60 * 1000), // Default: 6 hours from now
          updatedAt: Date.now()
        };

        console.log('[OK] Tokens loaded from environment variables for portal:', hub_id);
        console.log('   Env Portal ID:', tokens.hub_id);
        console.log('   Expires at:', new Date(tokens.expiresAt).toISOString());
        return tokens;
      }
    }

    console.log('[ERROR] No tokens found for portal:', hub_id);
    console.log('   Available portals in cache:', Array.from(cachedTokens.keys()));
    console.log('   Environment portal ID:', process.env.HUBSPOT_PORTAL_ID || 'not set');
    return null;
  }

  // Legacy: No hub_id provided - check environment variables only
  if (process.env.HUBSPOT_ACCESS_TOKEN && process.env.HUBSPOT_REFRESH_TOKEN) {
    const tokens = {
      hub_id: process.env.HUBSPOT_PORTAL_ID || 'env-var-portal',
      accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
      refreshToken: process.env.HUBSPOT_REFRESH_TOKEN,
      expiresAt: process.env.HUBSPOT_TOKEN_EXPIRES_AT
        ? parseInt(process.env.HUBSPOT_TOKEN_EXPIRES_AT)
        : Date.now() + (6 * 60 * 60 * 1000), // Default: 6 hours from now
      updatedAt: Date.now()
    };

    console.log('[OK] Tokens loaded from environment variables (no hub_id specified)');
    console.log('   Portal ID:', tokens.hub_id);
    console.log('   Expires at:', new Date(tokens.expiresAt).toISOString());
    return tokens;
  }

  console.log('[ERROR] No hub_id provided and no environment variables set');
  return null;
};

// Check if token needs refresh (refresh 5 minutes before expiry)
const needsRefresh = (tokens) => {
  if (!tokens || !tokens.expiresAt) return true;
  const fiveMinutes = 5 * 60 * 1000;
  return Date.now() > (tokens.expiresAt - fiveMinutes);
};

module.exports = {
  saveTokens,
  getTokens,
  needsRefresh
};

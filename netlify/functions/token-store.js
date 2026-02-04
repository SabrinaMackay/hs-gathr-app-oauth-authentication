// Token storage - Multi-tenant token storage by hub_id using Netlify Blobs
const { getStore } = require('@netlify/blobs');

// Get the token store (persisted across function invocations)
const getTokenStore = () => {
  return getStore('oauth-tokens');
};

// Save tokens to Netlify Blobs (persisted storage)
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

  try {
    const store = getTokenStore();
    await store.setJSON(`tokens:${hub_id}`, tokenData);
    console.log('[OK] Tokens saved to Netlify Blobs for portal:', hub_id);
  } catch (error) {
    console.error('[ERROR] Failed to save tokens to Netlify Blobs:', error.message);
    throw error;
  }

  return tokenData;
};

// Get current tokens from Netlify Blobs or environment variables
// For multi-tenant apps, hub_id is required to retrieve the correct tokens
const getTokens = async (hub_id) => {
  // Multi-tenant: Check Netlify Blobs first for hub-specific tokens
  if (hub_id) {
    try {
      const store = getTokenStore();
      const tokens = await store.getWithMetadata(`tokens:${hub_id}`, { type: 'json' });

      if (tokens && tokens.data) {
        console.log('[OK] Tokens loaded from Netlify Blobs for portal:', hub_id);
        console.log('   Stored:', Math.round((Date.now() - tokens.data.updatedAt) / 1000), 'seconds ago');
        return tokens.data;
      }
    } catch (error) {
      console.log('[WARN] Error reading from Netlify Blobs:', error.message);
    }

    // Check if environment variables match this hub_id (single-tenant fallback)
    if (process.env.HUBSPOT_ACCESS_TOKEN && process.env.HUBSPOT_REFRESH_TOKEN) {
      const envPortalId = process.env.HUBSPOT_PORTAL_ID;

      // Only return env tokens if they match the requested hub_id
      if (envPortalId && envPortalId === hub_id.toString()) {
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
      } else {
        console.log('[WARN] Environment tokens do not match requested portal');
        console.log('   Requested:', hub_id);
        console.log('   Env portal:', envPortalId || 'not set');
      }
    }

    console.log('[ERROR] No tokens found for portal:', hub_id);
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

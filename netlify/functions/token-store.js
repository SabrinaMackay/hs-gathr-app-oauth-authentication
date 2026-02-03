// Token storage using Netlify Blobs
// This allows tokens to persist across function invocations and be updated

const { getStore } = require('@netlify/blobs');

// Get or create the token store
const getTokenStore = () => {
  return getStore('oauth-tokens');
};

// Save tokens (called after OAuth or token refresh)
const saveTokens = async (tokens) => {
  const store = getTokenStore();
  
  const tokenData = {
    accessToken: tokens.accessToken || tokens.access_token,
    refreshToken: tokens.refreshToken || tokens.refresh_token,
    expiresAt: tokens.expiresAt || (Date.now() + ((tokens.expires_in || 21600) * 1000)),
    updatedAt: Date.now()
  };

  await store.set('hubspot_tokens', JSON.stringify(tokenData));
  console.log('✅ Tokens saved to blob storage');
  return tokenData;
};

// Get current tokens
const getTokens = async () => {
  const store = getTokenStore();
  const data = await store.get('hubspot_tokens');
  
  if (!data) {
    console.log('❌ No tokens found in blob storage');
    return null;
  }

  const tokens = JSON.parse(data);
  console.log('✅ Tokens loaded from blob storage');
  console.log('   Expires at:', new Date(tokens.expiresAt).toISOString());
  console.log('   Expired:', Date.now() > tokens.expiresAt);
  
  return tokens;
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

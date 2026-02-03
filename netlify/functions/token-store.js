// Token storage - Simple environment variable based approach
// For production, consider using a proper database like Redis or DynamoDB

// In-memory cache to avoid parsing JSON on every request
let cachedTokens = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute cache

// Save tokens to environment variable simulation (for demo)
// In production, this would write to a database
const saveTokens = async (tokens) => {
  const tokenData = {
    accessToken: tokens.accessToken || tokens.access_token,
    refreshToken: tokens.refreshToken || tokens.refresh_token,
    expiresAt: tokens.expiresAt || (Date.now() + ((tokens.expires_in || 21600) * 1000)),
    updatedAt: Date.now()
  };

  console.log('[STORE] Tokens would be saved to database (using cache for now)');
  console.log('   Access token (first 10 chars):', tokenData.accessToken.substring(0, 10) + '...');
  console.log('   Expires at:', new Date(tokenData.expiresAt).toISOString());
  
  // Cache the tokens in memory
  cachedTokens = tokenData;
  cacheTimestamp = Date.now();
  
  console.log('[WARN] NOTE: Tokens are cached in memory only');
  console.log('   For production, set HUBSPOT_ACCESS_TOKEN and HUBSPOT_REFRESH_TOKEN as environment variables');
  
  return tokenData;
};

// Get current tokens from environment variables or cache
const getTokens = async () => {
  // Check environment variables first (production setup)
  if (process.env.HUBSPOT_ACCESS_TOKEN && process.env.HUBSPOT_REFRESH_TOKEN) {
    const tokens = {
      accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
      refreshToken: process.env.HUBSPOT_REFRESH_TOKEN,
      expiresAt: process.env.HUBSPOT_TOKEN_EXPIRES_AT 
        ? parseInt(process.env.HUBSPOT_TOKEN_EXPIRES_AT) 
        : Date.now() + (6 * 60 * 60 * 1000), // Default: 6 hours from now
      updatedAt: Date.now()
    };
    
    console.log('[OK] Tokens loaded from environment variables');
    console.log('   Expires at:', new Date(tokens.expiresAt).toISOString());
    return tokens;
  }
  
  // Fall back to cached tokens (from recent OAuth flow)
  if (cachedTokens && (Date.now() - cacheTimestamp) < CACHE_TTL * 10) { // 10 minute cache for tokens
    console.log('[OK] Tokens loaded from cache');
    console.log('   Cached:', Math.round((Date.now() - cacheTimestamp) / 1000), 'seconds ago');
    return cachedTokens;
  }
  
  console.log('[ERROR] No tokens found in environment or cache');
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

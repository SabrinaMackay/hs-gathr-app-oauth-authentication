// Token storage - Multi-tenant token storage by hub_id
// Supports multiple storage backends: Redis (AWS ElastiCache), Environment Variables
const Redis = require('ioredis');

// Storage backend configuration
const STORAGE_BACKEND = process.env.TOKEN_STORAGE_BACKEND || 'env'; // 'redis' or 'env'
const AWS_REDIS_HOST = process.env.AWS_REDIS_HOST;
const AWS_REDIS_PORT = process.env.AWS_REDIS_PORT || 6379;
const AWS_REDIS_PASSWORD = process.env.AWS_REDIS_PASSWORD;

// Create Redis client (lazy initialization)
let redisClient = null;
const getRedisClient = () => {
  if (!redisClient && AWS_REDIS_HOST) {
    redisClient = new Redis({
      host: AWS_REDIS_HOST,
      port: AWS_REDIS_PORT,
      password: AWS_REDIS_PASSWORD,
      tls: process.env.AWS_REDIS_TLS === 'true' ? {} : undefined,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3
    });

    redisClient.on('error', (err) => {
      console.error('[REDIS] Connection error:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('[REDIS] Connected to AWS Redis');
    });
  }
  return redisClient;
};

// Redis storage functions (using AWS ElastiCache with ioredis)
const saveToRedis = async (hub_id, tokenData) => {
  const client = getRedisClient();
  if (!client) {
    throw new Error('Redis configuration missing: AWS_REDIS_HOST required');
  }

  try {
    await client.set(`tokens:${hub_id}`, JSON.stringify(tokenData));
    console.log('[OK] Tokens saved to Redis for portal:', hub_id);
  } catch (error) {
    throw new Error(`Redis SET failed: ${error.message}`);
  }
};

const getFromRedis = async (hub_id) => {
  const client = getRedisClient();
  if (!client) {
    return null;
  }

  try {
    const data = await client.get(`tokens:${hub_id}`);
    if (data) {
      const tokenData = JSON.parse(data);
      console.log('[OK] Tokens loaded from Redis for portal:', hub_id);
      console.log('   Stored:', Math.round((Date.now() - tokenData.updatedAt) / 1000), 'seconds ago');
      return tokenData;
    }

    return null;
  } catch (error) {
    console.log('[WARN] Error reading from Redis:', error.message);
    return null;
  }
};

// Save tokens (supports multiple backends)
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
  console.log('   Storage backend:', STORAGE_BACKEND);

  // Try Redis first if configured
  if (STORAGE_BACKEND === 'redis' && AWS_REDIS_HOST) {
    try {
      await saveToRedis(hub_id, tokenData);
      return tokenData;
    } catch (error) {
      console.error('[ERROR] Failed to save to Redis:', error.message);
      console.log('[WARN] Tokens saved in memory only (will be lost on function restart)');
    }
  }

  // Fallback: Log instructions for manual storage
  console.log('[WARN] No persistent storage configured - tokens will be lost on function restart');
  console.log('[INFO] To enable persistent storage, set these environment variables:');
  console.log('   TOKEN_STORAGE_BACKEND=redis');
  console.log('   AWS_REDIS_HOST=<your-redis-host>');
  console.log('   AWS_REDIS_PORT=<your-redis-port> (default: 6379)');
  console.log('   AWS_REDIS_PASSWORD=<your-redis-password> (optional)');
  console.log('   AWS_REDIS_TLS=true (optional, for TLS connections)');
  console.log('[INFO] Or manually set these environment variables for single-portal:');
  console.log('   HUBSPOT_PORTAL_ID=' + hub_id);
  console.log('   HUBSPOT_ACCESS_TOKEN=' + tokenData.accessToken);
  console.log('   HUBSPOT_REFRESH_TOKEN=' + tokenData.refreshToken);

  return tokenData;
};

// Get tokens (checks multiple sources in order)
const getTokens = async (hub_id) => {
  if (!hub_id) {
    console.log('[ERROR] hub_id is required to retrieve tokens');
    return null;
  }

  // 1. Try Redis if configured
  if (STORAGE_BACKEND === 'redis' && AWS_REDIS_HOST) {
    const tokens = await getFromRedis(hub_id);
    if (tokens) {
      return tokens;
    }
  }

  // 2. Check environment variables (single-portal fallback)
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
  console.log('   Storage backend:', STORAGE_BACKEND);
  console.log('   Redis configured:', AWS_REDIS_HOST ? 'yes' : 'no');
  console.log('   Environment portal ID:', process.env.HUBSPOT_PORTAL_ID || 'not set');
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

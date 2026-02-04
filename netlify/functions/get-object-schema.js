const fetch = require('node-fetch');
const { getTokens, needsRefresh, saveTokens } = require('./token-store');

// Get the current access token (with auto-refresh)
const getAccessToken = async () => {
    console.log('[AUTH] Getting access token...');

    try {
        const tokens = await getTokens();

        if (tokens && tokens.accessToken) {
            console.log('   [OK] Found tokens in storage');

            // Check if token needs refresh
            if (needsRefresh(tokens)) {
                console.log('   [REFRESH] Token expired or expiring soon, refreshing...');
                const newTokens = await refreshAccessToken(tokens.refreshToken);
                return newTokens.accessToken;
            }

            return tokens.accessToken;
        }
    } catch (error) {
        console.log('   [WARN] Error accessing token storage:', error.message);
    }

    // Fallback to environment variables
    if (process.env.HUBSPOT_ACCESS_TOKEN) {
        console.log('   [OK] Falling back to environment variable');
        return process.env.HUBSPOT_ACCESS_TOKEN;
    }

    console.log('   [ERROR] No access token found');
    return null;
};

// Refresh token helper
const refreshAccessToken = async (refreshToken) => {
    console.log('[REFRESH] Refreshing access token...');

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

    console.log('[OK] Token refreshed successfully');

    const newTokenData = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || tokenToUse,
        expiresAt: Date.now() + (tokens.expires_in * 1000)
    };

    try {
        await saveTokens(newTokenData);
        console.log('   [OK] New tokens saved to storage');
    } catch (error) {
        console.error('   [WARN] Failed to save refreshed tokens:', error.message);
    }

    return newTokenData;
};

exports.handler = async (event, context) => {
    console.log('[GET OBJECT SCHEMA] Get Object Schema Function Invoked');

    // Enable CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        console.log('   Handling OPTIONS preflight request');
        return { statusCode: 200, headers, body: '' };
    }

    // Only accept POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
        };
    }
    try {
        // Parse request body
        const body = JSON.parse(event.body);
        const { hubspotRegion } = body;

        console.log('[REQUEST] Get object schema request:', {
            hubspotRegion
        });


        // Get access token
        let accessToken = await getAccessToken();

        if (!accessToken) {
            console.error('[ERROR] No access token available');
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({
                    error: 'No access token available. Please authenticate first.',
                    needsAuth: true
                })
            };
        }

        console.log('[OK] Access token found');

        // Construct HubSpot API URL
        const region = hubspotRegion || 'https://api-eu1.hubapi.com';
        const hubspotUrl = `${region}/crm-object-schemas/v3/schemas`;

        console.log('[HUBSPOT] Fetching object schema:', {
            url: hubspotUrl
        });

        const requestStart = Date.now();

        // Make the request to HubSpot
        let response = await fetch(hubspotUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const requestDuration = Date.now() - requestStart;

        console.log('[HUBSPOT] Response received:', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            duration: requestDuration
        });

        // If 401, try to refresh token and retry once
        if (response.status === 401) {
            console.log('[REFRESH] Received 401, attempting to refresh token...');
            try {
                const tokens = await getTokens();
                if (tokens && tokens.refreshToken) {
                    const newTokens = await refreshAccessToken(tokens.refreshToken);
                    accessToken = newTokens.accessToken;

                    // Retry request with new token
                    response = await fetch(hubspotUrl, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    console.log('[HUBSPOT] Retry response after refresh:', response.status);
                }
            } catch (refreshError) {
                console.error('[ERROR] Token refresh failed:', refreshError.message);
            }
        }

        // Get response body
        const contentType = response.headers.get('content-type');
        let responseBody;

        if (contentType && contentType.includes('application/json')) {
            responseBody = await response.json();
        } else {
            responseBody = await response.text();
        }

        console.log('[OK] Returning object schema response, status:', response.status);

        // Return the response
        return {
            statusCode: response.status,
            headers,
            body: typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
        };
    } catch (error) {
        console.error('[ERROR] Error in Get Object Schema Function:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        };
    }
};
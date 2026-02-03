# HubSpot OAuth Setup Guide

This guide will help you set up OAuth authentication for your HubSpot card.

## Step 1: Deploy Updated Functions to Netlify

```bash
cd /Users/sabrinamackay/dev/hs-gathr-app-oauth-authentication
netlify deploy --prod
```

Or if you're using Git deployment, just push your changes:

```bash
git add .
git commit -m "Add OAuth proxy with environment variable support"
git push
```

## Step 2: Complete OAuth Flow

1. Visit: `https://hs-gathr-oauth.netlify.app/.netlify/functions/oauth-start`
   
2. You'll be redirected to HubSpot to authorize the app

3. After authorization, you'll see a success page with your tokens:
   - **HUBSPOT_ACCESS_TOKEN** 
   - **HUBSPOT_REFRESH_TOKEN**

4. Copy both tokens (use the copy buttons on the page)

## Step 3: Add Tokens to Netlify Environment Variables

1. Go to: https://app.netlify.com

2. Select your site: **hs-gathr-oauth**

3. Navigate to: **Site settings** → **Environment variables**

4. Click **Add a variable**

5. Add these two variables:
   - Key: `HUBSPOT_ACCESS_TOKEN`
     Value: [paste the access token]
   
   - Key: `HUBSPOT_REFRESH_TOKEN`
     Value: [paste the refresh token]

6. **Important**: After adding the variables, trigger a new deploy:
   - Go to **Deploys** tab
   - Click **Trigger deploy** → **Clear cache and deploy site**

## Step 4: Test the HubSpot Card

Once the Netlify site is redeployed with the environment variables:

```bash
cd /Users/sabrinamackay/dev/hubspot/gathr
hs project upload
hs project dev
```

Your card will now use the OAuth proxy for all HubSpot API calls automatically!

## Debugging

### Check Netlify Function Logs

1. Go to your Netlify site
2. Click **Functions** tab
3. Click on `hubspot-proxy`
4. View the logs to see if:
   - The function is being called
   - The access token is found
   - Requests are being proxied correctly

### Common Issues

**431 Error**: This usually means:
- The access token is missing or invalid
- Check that environment variables are set correctly
- Make sure you redeployed after adding env vars

**401 Error**: Authentication failed
- The access token may have expired
- The refresh token should automatically refresh it
- Check function logs for refresh attempts

**No logs showing**: The proxy function isn't being called
- Check that the URL in `GathrCard.tsx` matches your Netlify URL
- Verify CORS headers are allowing the request
- Check browser console for CORS errors

## Architecture

```
┌─────────────────┐
│  HubSpot Card   │
│                 │
│  Sends request  │
│  with path      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Netlify Function│
│  hubspot-proxy  │
│                 │
│  Reads OAuth    │
│  token from     │
│  env vars       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  HubSpot API    │
│                 │
│  with Bearer    │
│  token          │
└─────────────────┘
```

## Production Considerations

For production use, consider:

1. **Token Storage**: Use a database (like Redis, MongoDB, or DynamoDB) instead of environment variables to store tokens per user
2. **Token Refresh**: Implement automatic token refresh before expiration
3. **Error Handling**: Add retry logic and better error messages
4. **Monitoring**: Set up alerts for failed OAuth flows or API calls
5. **Security**: Add request validation and rate limiting

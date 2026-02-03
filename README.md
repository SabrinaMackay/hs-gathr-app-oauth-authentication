# HubSpot OAuth 2.0 Token Exchange Server

A serverless OAuth 2.0 token exchange server for HubSpot apps, deployed on Netlify.

## 🚀 Overview

This application implements the HubSpot OAuth 2.0 Authorization Code grant flow, allowing users to authorize your HubSpot app and exchange authorization codes for access tokens securely.

### How it works

The OAuth 2.0 flow consists of four basic steps:

1. **User Authorization**: Your app redirects the user to HubSpot's OAuth authorization page
2. **Permission Grant**: The user reviews and grants the requested permissions
3. **Callback**: HubSpot redirects the user back to your app with an authorization code
4. **Token Exchange**: Your app exchanges the authorization code for an access token and refresh token

## 📋 Prerequisites

- A [HubSpot Developer Account](https://developers.hubspot.com/)
- A [Netlify Account](https://netlify.com) (free tier works fine)
- Node.js installed locally (for testing)
- Git installed locally

## 🔧 Setup Instructions

### 1. Create a HubSpot App

1. Go to [HubSpot Developer Portal](https://app.hubspot.com/developers)
2. Click **"Create app"**
3. Fill in your app details (name, description, etc.)
4. Go to the **"Auth"** tab
5. Note your **Client ID** and **Client secret**
6. Set the **Redirect URL** to: `https://your-site-name.netlify.app/oauth-callback`
   (You'll get the actual URL after deploying to Netlify)
7. Select the **Scopes** you need (e.g., `crm.objects.contacts.read`)
8. Save your app

### 2. Deploy to Netlify

#### Option A: Deploy via Netlify UI (Recommended for first deployment)

1. **Push this repo to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/your-username/your-repo-name.git
   git push -u origin main
   ```

2. **Connect to Netlify**
   - Go to [Netlify](https://app.netlify.com/)
   - Click **"Add new site"** → **"Import an existing project"**
   - Choose **GitHub** and authorize Netlify
   - Select your repository

3. **Configure Build Settings**
   - Build command: `npm install` (or leave empty)
   - Publish directory: `public`
   - Functions directory: `netlify/functions`

4. **Add Environment Variables**
   - Go to **Site settings** → **Environment variables**
   - Add the following variables:
     - `CLIENT_ID`: Your HubSpot app client ID
     - `CLIENT_SECRET`: Your HubSpot app client secret
     - `SCOPE`: Space-separated scopes (e.g., `crm.objects.contacts.read`)

5. **Deploy**
   - Click **"Deploy site"**
   - Wait for deployment to complete
   - Note your site URL (e.g., `https://your-site-name.netlify.app`)

6. **Update HubSpot App Redirect URI**
   - Go back to your HubSpot app settings
   - Update the Redirect URL to: `https://your-site-name.netlify.app/oauth-callback`
   - Save the changes

#### Option B: Deploy via Netlify CLI

1. **Install Netlify CLI**
   ```bash
   npm install -g netlify-cli
   ```

2. **Login to Netlify**
   ```bash
   netlify login
   ```

3. **Initialize the site**
   ```bash
   netlify init
   ```

4. **Set environment variables**
   ```bash
   netlify env:set CLIENT_ID "your-hubspot-client-id"
   netlify env:set CLIENT_SECRET "your-hubspot-client-secret"
   netlify env:set SCOPE "crm.objects.contacts.read"
   ```

5. **Deploy**
   ```bash
   netlify deploy --prod
   ```

6. **Update HubSpot App Redirect URI**
   - Update the Redirect URL in your HubSpot app to match your Netlify URL

## 🧪 Local Development

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create a `.env` file** (copy from `env.example`)
   ```bash
   CLIENT_ID=your-hubspot-client-id
   CLIENT_SECRET=your-hubspot-client-secret
   SCOPE=crm.objects.contacts.read
   ```

3. **Run the development server**
   ```bash
   netlify dev
   ```

4. **Test the OAuth flow**
   - Open `http://localhost:8888` in your browser
   - Click "Install / Authorize App"
   - Complete the OAuth flow

   **Note**: For local development, you'll need to add `http://localhost:8888/oauth-callback` as a redirect URI in your HubSpot app settings.

## 📁 Project Structure

```
.
├── netlify/
│   └── functions/
│       ├── install.js           # Redirects to HubSpot OAuth page
│       └── oauth-callback.js    # Handles OAuth callback and token exchange
├── public/
│   └── index.html               # Static frontend
├── netlify.toml                 # Netlify configuration
├── package.json                 # Dependencies and scripts
├── env.example                  # Environment variables template
├── .gitignore                   # Git ignore rules
└── README.md                    # This file
```

## 🔐 Security Notes

### Important Security Considerations

1. **Client Secret**: Never expose your `CLIENT_SECRET` in client-side code. It's only used in serverless functions.

2. **Token Storage**: This demo stores tokens in HTTP-only cookies for simplicity. For production:
   - Store tokens in a secure database (e.g., MongoDB, PostgreSQL)
   - Associate tokens with user accounts
   - Implement proper token refresh logic
   - Consider using a session store like Redis

3. **HTTPS**: Netlify automatically provides HTTPS, which is required for OAuth

4. **Token Expiry**: Access tokens expire. In production, implement automatic token refresh using the refresh token

## 🔄 Token Refresh

The current implementation stores the refresh token but doesn't automatically refresh expired access tokens. To implement this:

1. Create a new function `netlify/functions/refresh-token.js`
2. Check token expiry before making API calls
3. Use the refresh token to get a new access token when needed
4. Update the stored tokens

Example refresh token request:
```javascript
const refreshTokenProof = {
  grant_type: 'refresh_token',
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  refresh_token: storedRefreshToken
};
```

## 📚 Resources

- [HubSpot OAuth Documentation](https://developers.hubspot.com/docs/api/oauth-quickstart-guide)
- [Netlify Functions Documentation](https://docs.netlify.com/functions/overview/)
- [HubSpot API Reference](https://developers.hubspot.com/docs/api/overview)

## 🤝 Contributing

Feel free to submit issues and pull requests!

## 📄 License

MIT License - feel free to use this for your own projects!

## 🆘 Troubleshooting

### "Missing CLIENT_ID or CLIENT_SECRET"
- Make sure you've set environment variables in Netlify
- Redeploy your site after adding environment variables

### "Invalid redirect_uri"
- Ensure the redirect URI in your HubSpot app matches your Netlify URL exactly
- Format: `https://your-site-name.netlify.app/oauth-callback`

### "Token exchange failed"
- Check your CLIENT_SECRET is correct
- Verify your authorization code hasn't been used already (codes are single-use)
- Make sure your app has the correct scopes

### Local development not working
- Install Netlify CLI: `npm install -g netlify-cli`
- Use `netlify dev` instead of `npm start`
- Add `http://localhost:8888/oauth-callback` to your HubSpot app's redirect URIs

## 🎯 Next Steps

After deploying, you can:
1. Customize the frontend design in `public/index.html`
2. Add more API endpoints as Netlify Functions
3. Implement token refresh logic
4. Add a database for persistent token storage
5. Build additional features using the HubSpot API

---

**Built with ❤️ for HubSpot developers**

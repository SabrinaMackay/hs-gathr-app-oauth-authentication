// Step 1: Redirect user to HubSpot OAuth authorization URL

exports.handler = async (event, context) => {
  const CLIENT_ID = process.env.CLIENT_ID;
  const SCOPES = process.env.SCOPE || 'crm.objects.contacts.read';
  const REDIRECT_URI = process.env.REDIRECT_URI || `${process.env.URL}/oauth-callback`;

  if (!CLIENT_ID) {
    return {
      statusCode: 500,
      body: 'Missing CLIENT_ID environment variable'
    };
  }

  console.log('=== Initiating OAuth 2.0 flow with HubSpot ===');
  console.log("===> Step 1: Redirecting user to HubSpot's OAuth URL");

  const authUrl =
    'https://app.hubspot.com/oauth/authorize' +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  return {
    statusCode: 302,
    headers: {
      Location: authUrl,
      'Cache-Control': 'no-cache'
    },
    body: ''
  };
};

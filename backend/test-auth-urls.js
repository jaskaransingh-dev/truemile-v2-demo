// test-auth-urls.js
// Run with: node test-auth-urls.js

require('dotenv').config();

console.log('\n=== OAuth Authentication URLs ===\n');

const TEST_USER_ID = 'test-user-123'; // Replace with your actual user ID

// Gmail OAuth URL
const gmailParams = new URLSearchParams({
  access_type: 'offline',
  scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email openid',
  response_type: 'code',
  client_id: process.env.GOOGLE_CLIENT_ID,
  redirect_uri: 'http://localhost:3000/api/auth/gmail/callback',
  state: JSON.stringify({ userId: TEST_USER_ID, provider: 'gmail' }),
  prompt: 'consent'
});

const gmailUrl = `https://accounts.google.com/o/oauth2/v2/auth?${gmailParams.toString()}`;

console.log('📧 GMAIL:');
console.log(gmailUrl);

// Outlook OAuth URL  
const outlookParams = new URLSearchParams({
  client_id: process.env.MICROSOFT_CLIENT_ID,
  response_type: 'code',
  redirect_uri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3000/api/auth/outlook/callback',
  response_mode: 'query',
  scope: 'Mail.Read offline_access User.Read',
  state: JSON.stringify({ userId: TEST_USER_ID, provider: 'outlook' }),
  prompt: 'consent'
});

const outlookUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${outlookParams.toString()}`;

console.log('\n📨 OUTLOOK:');
console.log(outlookUrl);

console.log('\n\n📋 Instructions:');
console.log('1. Copy each URL above');
console.log('2. Paste in your browser');
console.log('3. Complete the OAuth flow');
console.log('4. After authorization, you\'ll be redirected to your callback');
console.log('5. Check your server logs to confirm tokens were stored');
console.log('6. Run your sync again!\n');

console.log('⚠️  Make sure your server is running on http://localhost:3000');
console.log('    and the callback routes are set up!\n');
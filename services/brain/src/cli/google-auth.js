require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

const TOKEN_PATH = path.join(os.homedir(), '.config/secondbrain/google-token.json');

async function main() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in services/brain/.env');
    console.error('Create credentials at https://console.cloud.google.com/apis/credentials (type: Desktop app)');
    process.exit(1);
  }

  const port = await ephemeralPort();
  const redirectUri = `http://127.0.0.1:${port}`;
  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });

  console.log('\n[google-auth] Open this URL in your browser to authorize the brain:\n');
  console.log(url);
  console.log('\n[google-auth] Listening on', redirectUri, '...\n');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, redirectUri);
      const c = u.searchParams.get('code');
      if (c) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Authorization received. You can close this tab.');
        server.close();
        resolve(c);
      } else {
        res.writeHead(400);
        res.end('No code');
        server.close();
        reject(new Error('No code in redirect'));
      }
    });
    server.listen(port);
    setTimeout(() => { server.close(); reject(new Error('OAuth timeout')); }, 5 * 60 * 1000);
  });

  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    console.error('[google-auth] No refresh_token returned. Revoke prior consent at https://myaccount.google.com/permissions and retry.');
    process.exit(1);
  }

  await fs.mkdir(path.dirname(TOKEN_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), { encoding: 'utf8', mode: 0o600 });
  console.log(`\n[google-auth] Token saved to ${TOKEN_PATH}`);
  console.log('[google-auth] Done. Restart the brain to pick up the new token.');
}

function ephemeralPort() {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

main().catch((err) => {
  console.error('[google-auth] failed:', err.message);
  process.exit(1);
});

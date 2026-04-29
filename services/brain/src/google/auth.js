const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { google } = require('googleapis');

const DEFAULT_TOKEN_PATH = path.join(os.homedir(), '.config/secondbrain/google-token.json');

async function loadGoogleAuth({ google: googleCfg, tokenPath = DEFAULT_TOKEN_PATH }) {
  if (!googleCfg) return null;

  let token;
  try {
    const raw = await fs.readFile(tokenPath, 'utf8');
    token = JSON.parse(raw);
  } catch {
    return null;
  }

  const client = new google.auth.OAuth2(googleCfg.clientId, googleCfg.clientSecret);
  client.setCredentials(token);
  return client;
}

module.exports = { loadGoogleAuth, DEFAULT_TOKEN_PATH };

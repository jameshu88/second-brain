require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const fs = require('node:fs/promises');
const path = require('node:path');
const { WebClient } = require('@slack/web-api');
const Anthropic = require('@anthropic-ai/sdk');

async function runDoctor({ env, fetchSlackAuth, fetchAnthropicAuth, fetchGoogleAuth }) {
  const checks = [];

  const required = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET', 'VAULT_PATH', 'ANTHROPIC_API_KEY'];
  const missing = required.filter((k) => !env[k] || env[k].trim() === '');
  checks.push({
    name: 'env',
    ok: missing.length === 0,
    message: missing.length === 0 ? 'all required vars present' : `missing: ${missing.join(', ')}`,
  });

  const vaultPath = env.VAULT_PATH || '';
  let vaultOk = false;
  let vaultMsg = '';
  try {
    const stat = await fs.stat(vaultPath);
    if (!stat.isDirectory()) {
      vaultMsg = 'VAULT_PATH is not a directory';
    } else {
      const probe = path.join(vaultPath, `.brain-write-probe-${process.pid}`);
      await fs.writeFile(probe, 'x', 'utf8');
      await fs.unlink(probe);
      vaultOk = true;
      vaultMsg = `${vaultPath} is readable + writable`;
    }
  } catch (err) {
    vaultMsg = `vault unreachable: ${err.message}`;
  }
  checks.push({ name: 'vault', ok: vaultOk, message: vaultMsg });

  let inboxOk = false;
  let inboxMsg = '';
  if (vaultOk) {
    try {
      const stat = await fs.stat(path.join(vaultPath, '00_Inbox'));
      inboxOk = stat.isDirectory();
      inboxMsg = inboxOk ? '00_Inbox/ present' : '00_Inbox/ exists but is not a directory';
    } catch {
      inboxMsg = '00_Inbox/ missing (will be created on first capture)';
      inboxOk = true;
    }
  } else {
    inboxMsg = 'skipped (vault check failed)';
  }
  checks.push({ name: 'inbox', ok: inboxOk, message: inboxMsg });

  let slackOk = false;
  let slackMsg = '';
  if (missing.includes('SLACK_BOT_TOKEN')) {
    slackMsg = 'skipped (no token)';
  } else {
    try {
      const auth = await fetchSlackAuth(env.SLACK_BOT_TOKEN);
      if (auth.ok) {
        slackOk = true;
        slackMsg = `auth ok: user=${auth.user || '?'} team=${auth.team || '?'}`;
      } else {
        slackMsg = `auth failed: ${auth.error || 'unknown'}`;
      }
    } catch (err) {
      slackMsg = `auth call threw: ${err.message}`;
    }
  }
  checks.push({ name: 'slack', ok: slackOk, message: slackMsg });

  let antOk = false;
  let antMsg = '';
  if (missing.includes('ANTHROPIC_API_KEY')) {
    antMsg = 'skipped (no key)';
  } else {
    try {
      const auth = await fetchAnthropicAuth(env.ANTHROPIC_API_KEY);
      if (auth.ok) {
        antOk = true;
        antMsg = 'auth ok';
      } else {
        antMsg = `auth failed: ${auth.error || 'unknown'}`;
      }
    } catch (err) {
      antMsg = `auth call threw: ${err.message}`;
    }
  }
  checks.push({ name: 'anthropic', ok: antOk, message: antMsg });

  let gOk = false;
  let gMsg = '';
  const googleConfigured = Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
  if (!googleConfigured) {
    gOk = true;
    gMsg = 'not configured (calendar features disabled — set GOOGLE_OAUTH_* to enable)';
  } else {
    try {
      const auth = await fetchGoogleAuth(env);
      if (auth.configured && auth.ok) {
        gOk = true;
        gMsg = 'auth ok';
      } else if (auth.configured && !auth.ok) {
        gMsg = `auth failed: ${auth.error || 'unknown'}`;
      } else {
        gOk = true;
        gMsg = 'not configured';
      }
    } catch (err) {
      gMsg = `auth call threw: ${err.message}`;
    }
  }
  checks.push({ name: 'google', ok: gOk, message: gMsg });

  return checks;
}

async function realFetchSlackAuth(token) {
  const client = new WebClient(token);
  return client.auth.test();
}

async function realFetchAnthropicAuth(apiKey) {
  try {
    const client = new Anthropic({ apiKey });
    // Tiny probe: 1-token Haiku call. Authenticates without burning inference cost (<$0.000005).
    // Earlier SDKs (<0.40) don't expose client.models, so we use messages.create which has been
    // stable since 0.x.
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function realFetchGoogleAuth(env) {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return { ok: true, configured: false };
  }
  try {
    const { google } = require('googleapis');
    const { loadGoogleAuth } = require('../google/auth');
    const oauth = await loadGoogleAuth({
      google: { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET },
    });
    if (!oauth) {
      return { ok: false, configured: true, error: 'token file missing — run `npm run brain:google-auth`' };
    }
    const cal = google.calendar({ version: 'v3', auth: oauth });
    await cal.calendars.get({ calendarId: 'primary' });
    return { ok: true, configured: true };
  } catch (err) {
    return { ok: false, configured: true, error: err.message };
  }
}

async function cli() {
  const checks = await runDoctor({
    env: process.env,
    fetchSlackAuth: realFetchSlackAuth,
    fetchAnthropicAuth: realFetchAnthropicAuth,
    fetchGoogleAuth: realFetchGoogleAuth,
  });
  let allOk = true;
  for (const c of checks) {
    const tag = c.ok ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${c.name.padEnd(10)} ${c.message}`);
    if (!c.ok) allOk = false;
  }
  process.exit(allOk ? 0 : 1);
}

if (require.main === module) {
  cli();
}

module.exports = { runDoctor };

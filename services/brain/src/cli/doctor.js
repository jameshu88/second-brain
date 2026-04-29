require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const fs = require('node:fs/promises');
const path = require('node:path');
const { WebClient } = require('@slack/web-api');

async function runDoctor({ env, fetchSlackAuth }) {
  const checks = [];

  const required = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET', 'VAULT_PATH'];
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

  return checks;
}

async function realFetchSlackAuth(token) {
  const client = new WebClient(token);
  return client.auth.test();
}

async function cli() {
  const checks = await runDoctor({ env: process.env, fetchSlackAuth: realFetchSlackAuth });
  let allOk = true;
  for (const c of checks) {
    const tag = c.ok ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${c.name.padEnd(8)} ${c.message}`);
    if (!c.ok) allOk = false;
  }
  process.exit(allOk ? 0 : 1);
}

if (require.main === module) {
  cli();
}

module.exports = { runDoctor };

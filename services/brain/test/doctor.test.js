const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runDoctor } = require('../src/cli/doctor');

async function tmpVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-doc-'));
  await fs.mkdir(path.join(dir, '00_Inbox'), { recursive: true });
  return dir;
}

test('doctor PASSes with valid env and reachable Slack', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
    ANTHROPIC_API_KEY: 'sk-ant-test',
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true, user: 'brain', team: 'T1' }),
    fetchAnthropicAuth: async () => ({ ok: true }),
  });
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks, null, 2));
  await fs.rm(vault, { recursive: true, force: true });
});

test('doctor FAILs when SLACK_APP_TOKEN missing', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: '',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
    ANTHROPIC_API_KEY: 'sk-ant-test',
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true }),
    fetchAnthropicAuth: async () => ({ ok: true }),
  });
  const env_check = checks.find((c) => c.name === 'env');
  assert.equal(env_check.ok, false);
  assert.match(env_check.message, /SLACK_APP_TOKEN/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('doctor FAILs when vault is not writable', async () => {
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: '/no/such/path/vault',
    ANTHROPIC_API_KEY: 'sk-ant-test',
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true }),
    fetchAnthropicAuth: async () => ({ ok: true }),
  });
  const vault_check = checks.find((c) => c.name === 'vault');
  assert.equal(vault_check.ok, false);
});

test('doctor FAILs when Slack auth call returns ok=false', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
    ANTHROPIC_API_KEY: 'sk-ant-test',
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: false, error: 'invalid_auth' }),
    fetchAnthropicAuth: async () => ({ ok: true }),
  });
  const slack_check = checks.find((c) => c.name === 'slack');
  assert.equal(slack_check.ok, false);
  assert.match(slack_check.message, /invalid_auth/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('doctor PASSes anthropic check when ping returns ok', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
    ANTHROPIC_API_KEY: 'sk-ant-test',
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true }),
    fetchAnthropicAuth: async () => ({ ok: true }),
  });
  const ant = checks.find((c) => c.name === 'anthropic');
  assert.equal(ant.ok, true);
  await fs.rm(vault, { recursive: true, force: true });
});

test('doctor FAILs anthropic check on bad auth', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
    ANTHROPIC_API_KEY: 'sk-ant-test',
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true }),
    fetchAnthropicAuth: async () => ({ ok: false, error: 'invalid_api_key' }),
  });
  const ant = checks.find((c) => c.name === 'anthropic');
  assert.equal(ant.ok, false);
  assert.match(ant.message, /invalid_api_key/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('doctor FAILs env when ANTHROPIC_API_KEY is missing', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
    ANTHROPIC_API_KEY: '',
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true }),
    fetchAnthropicAuth: async () => ({ ok: true }),
  });
  const env_check = checks.find((c) => c.name === 'env');
  assert.equal(env_check.ok, false);
  assert.match(env_check.message, /ANTHROPIC_API_KEY/);
  await fs.rm(vault, { recursive: true, force: true });
});

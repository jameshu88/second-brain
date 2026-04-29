const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../src/config');

const BASE = {
  SLACK_BOT_TOKEN: 'xoxb-x',
  SLACK_APP_TOKEN: 'xapp-x',
  SLACK_SIGNING_SECRET: 's',
  VAULT_PATH: '/tmp/some-vault',
};

test('loadConfig returns a normalized config from env', () => {
  const cfg = loadConfig({ ...BASE, ALLOWED_SLACK_USER_IDS: 'U1, U2' });
  assert.equal(cfg.slack.botToken, 'xoxb-x');
  assert.equal(cfg.slack.appToken, 'xapp-x');
  assert.equal(cfg.slack.signingSecret, 's');
  assert.equal(cfg.vaultPath, path.resolve('/tmp/some-vault'));
  assert.deepEqual(cfg.allowedUserIds, ['U1', 'U2']);
  assert.equal(cfg.logLevel, 'info');
});

test('loadConfig defaults timezone to host TZ when blank', () => {
  const cfg = loadConfig({ ...BASE, TIMEZONE: '' });
  assert.equal(typeof cfg.timezone, 'string');
  assert.ok(cfg.timezone.length > 0);
});

test('loadConfig honors TIMEZONE override', () => {
  const cfg = loadConfig({ ...BASE, TIMEZONE: 'UTC' });
  assert.equal(cfg.timezone, 'UTC');
});

test('loadConfig fails fast when SLACK_BOT_TOKEN is missing', () => {
  assert.throws(() => loadConfig({ ...BASE, SLACK_BOT_TOKEN: '' }), /SLACK_BOT_TOKEN/);
});

test('loadConfig fails fast when SLACK_APP_TOKEN is missing (Socket Mode required)', () => {
  assert.throws(() => loadConfig({ ...BASE, SLACK_APP_TOKEN: '' }), /SLACK_APP_TOKEN/);
});

test('loadConfig fails fast when VAULT_PATH is missing', () => {
  assert.throws(() => loadConfig({ ...BASE, VAULT_PATH: '' }), /VAULT_PATH/);
});

test('loadConfig accepts empty ALLOWED_SLACK_USER_IDS as no allowlist', () => {
  const cfg = loadConfig(BASE);
  assert.deepEqual(cfg.allowedUserIds, []);
});

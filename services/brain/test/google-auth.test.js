const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { loadGoogleAuth } = require('../src/google/auth');

async function withTokenFile(content) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-goog-'));
  const tokenPath = path.join(dir, 'token.json');
  await fs.writeFile(tokenPath, JSON.stringify(content), 'utf8');
  return { dir, tokenPath };
}

test('loadGoogleAuth returns null when google config absent', async () => {
  const out = await loadGoogleAuth({ google: null, tokenPath: '/no/such/file' });
  assert.equal(out, null);
});

test('loadGoogleAuth returns null when token file is missing', async () => {
  const out = await loadGoogleAuth({
    google: { clientId: 'cid', clientSecret: 'sec' },
    tokenPath: '/no/such/file.json',
  });
  assert.equal(out, null);
});

test('loadGoogleAuth returns OAuth2 client when token file is valid', async () => {
  const { dir, tokenPath } = await withTokenFile({ refresh_token: 'r', access_token: 'a' });
  const out = await loadGoogleAuth({
    google: { clientId: 'cid', clientSecret: 'sec' },
    tokenPath,
  });
  assert.ok(out);
  assert.equal(typeof out.setCredentials, 'function');
  await fs.rm(dir, { recursive: true, force: true });
});

test('loadGoogleAuth surfaces malformed token file as null', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-goog-'));
  const tokenPath = path.join(dir, 'token.json');
  await fs.writeFile(tokenPath, '{not valid json', 'utf8');
  const out = await loadGoogleAuth({
    google: { clientId: 'cid', clientSecret: 'sec' },
    tokenPath,
  });
  assert.equal(out, null);
  await fs.rm(dir, { recursive: true, force: true });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { setPending, getPending, clearPending, _setPathOverride } = require('../src/state/threads');

async function tmpStateDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-state-'));
}

test('setPending then getPending round-trips an action', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  await setPending('1746000000.000000', { kind: 'create_event', args: { title: 'Pitch prep' } });
  const got = await getPending('1746000000.000000');
  assert.equal(got.kind, 'create_event');
  assert.equal(got.args.title, 'Pitch prep');
  await fs.rm(dir, { recursive: true, force: true });
});

test('getPending returns null for unknown thread', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  const got = await getPending('does-not-exist');
  assert.equal(got, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('getPending returns null after expiry', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  await setPending('t1', { kind: 'create_event', args: {} }, { ttlMs: 10 });
  await new Promise((r) => setTimeout(r, 25));
  const got = await getPending('t1');
  assert.equal(got, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('clearPending removes a stored action', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  await setPending('t1', { kind: 'x', args: {} });
  await clearPending('t1');
  const got = await getPending('t1');
  assert.equal(got, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('store survives multiple actions for different threads', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  await setPending('t1', { kind: 'a', args: { x: 1 } });
  await setPending('t2', { kind: 'b', args: { x: 2 } });
  const a = await getPending('t1');
  const b = await getPending('t2');
  assert.equal(a.kind, 'a');
  assert.equal(b.kind, 'b');
  await fs.rm(dir, { recursive: true, force: true });
});

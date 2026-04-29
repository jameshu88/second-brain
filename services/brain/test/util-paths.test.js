const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { safeJoin } = require('../src/util/paths');

const VAULT = '/tmp/vault-fixture';

test('safeJoin returns absolute path inside vault for clean input', () => {
  const out = safeJoin(VAULT, '00_Inbox/note.md');
  assert.equal(out, path.join(VAULT, '00_Inbox/note.md'));
});

test('safeJoin rejects parent traversal', () => {
  assert.throws(() => safeJoin(VAULT, '../etc/passwd'), /outside vault/i);
});

test('safeJoin rejects encoded traversal', () => {
  assert.throws(() => safeJoin(VAULT, '00_Inbox/..%2F..%2Fetc'), /outside vault/i);
});

test('safeJoin rejects absolute relative input', () => {
  assert.throws(() => safeJoin(VAULT, '/etc/passwd'), /absolute/i);
});

test('safeJoin rejects home-prefixed input', () => {
  assert.throws(() => safeJoin(VAULT, '~/secrets'), /absolute|outside vault/i);
});

test('safeJoin allows nested clean paths', () => {
  const out = safeJoin(VAULT, '01_Projects/FormLab AI/sub/note.md');
  assert.equal(out, path.join(VAULT, '01_Projects/FormLab AI/sub/note.md'));
});

test('safeJoin requires non-empty relative path', () => {
  assert.throws(() => safeJoin(VAULT, ''), /empty/i);
});

test('safeJoin rejects null byte in path', () => {
  assert.throws(() => safeJoin(VAULT, '%00'), /null byte/i);
  assert.throws(() => safeJoin(VAULT, '00_Inbox/x%00.md'), /null byte/i);
});

test('safeJoin rejects path that resolves to the vault root', () => {
  assert.throws(() => safeJoin(VAULT, '00_Inbox/..'), /outside vault/i);
  assert.throws(() => safeJoin(VAULT, '.'), /outside vault/i);
});

test('safeJoin allows literal .. inside a filename (not a traversal)', () => {
  const out = safeJoin(VAULT, '01_Projects/dot..dot/note.md');
  assert.equal(out, path.join(VAULT, '01_Projects/dot..dot/note.md'));
});

test('safeJoin collapses double-slashes inside a clean path', () => {
  const out = safeJoin(VAULT, '00_Inbox//note.md');
  assert.equal(out, path.join(VAULT, '00_Inbox/note.md'));
});

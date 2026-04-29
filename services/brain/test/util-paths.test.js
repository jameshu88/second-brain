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

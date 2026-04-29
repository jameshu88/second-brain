const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClient } = require('../src/agent/anthropic');

test('buildClient returns an object exposing messages.create', () => {
  const client = buildClient({ apiKey: 'sk-ant-test' });
  assert.ok(client);
  assert.equal(typeof client.messages.create, 'function');
});

test('buildClient throws when apiKey is missing', () => {
  assert.throws(() => buildClient({}), /apiKey/);
  assert.throws(() => buildClient({ apiKey: '' }), /apiKey/);
});

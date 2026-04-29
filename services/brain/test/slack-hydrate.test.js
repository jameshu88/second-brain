const test = require('node:test');
const assert = require('node:assert/strict');
const { hydrateThread } = require('../src/slack/hydrate');

function fakeClient(messages) {
  return {
    conversations: {
      replies: async () => ({ messages }),
    },
  };
}

test('hydrateThread returns last N messages mapped to user/assistant', async () => {
  const client = fakeClient([
    { user: 'U1', text: 'hi', ts: '1' },
    { bot_id: 'B1', text: 'hello', ts: '2' },
    { user: 'U1', text: 'how are you', ts: '3' },
  ]);
  const out = await hydrateThread({ client, channel: 'C', threadTs: '1', botUserId: 'UBOT', limit: 20 });
  assert.deepEqual(out, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'how are you' },
  ]);
});

test('hydrateThread classifies messages by botUserId user match too', async () => {
  const client = fakeClient([
    { user: 'UBOT', text: 'agent reply', ts: '1' },
    { user: 'U1', text: 'thx', ts: '2' },
  ]);
  const out = await hydrateThread({ client, channel: 'C', threadTs: '1', botUserId: 'UBOT', limit: 20 });
  assert.equal(out[0].role, 'assistant');
  assert.equal(out[1].role, 'user');
});

test('hydrateThread returns [] on API error', async () => {
  const client = { conversations: { replies: async () => { throw new Error('rate_limited'); } } };
  const out = await hydrateThread({ client, channel: 'C', threadTs: '1', botUserId: 'UBOT', limit: 20 });
  assert.deepEqual(out, []);
});

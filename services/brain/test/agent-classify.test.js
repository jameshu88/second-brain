const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMessage } = require('../src/agent/classify');

function fakeClient(verdict) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'tool_use', name: 'classify', input: { verdict } }],
      }),
    },
  };
}

test('classifyMessage returns "capture" when model says capture', async () => {
  const out = await classifyMessage({ client: fakeClient('capture'), model: 'm', text: 'rep counter idea' });
  assert.equal(out, 'capture');
});

test('classifyMessage returns "question" when model says question', async () => {
  const out = await classifyMessage({ client: fakeClient('question'), model: 'm', text: "what's on my calendar?" });
  assert.equal(out, 'question');
});

test('classifyMessage returns "both" when model says both', async () => {
  const out = await classifyMessage({ client: fakeClient('both'), model: 'm', text: 'idea: X — does this match Y?' });
  assert.equal(out, 'both');
});

test('classifyMessage falls back to "capture" on upstream error', async () => {
  const client = { messages: { create: async () => { throw new Error('boom'); } } };
  const out = await classifyMessage({ client, model: 'm', text: 'hi' });
  assert.equal(out, 'capture');
});

test('classifyMessage falls back to "capture" on invalid verdict', async () => {
  const out = await classifyMessage({ client: fakeClient('garbage'), model: 'm', text: 'hi' });
  assert.equal(out, 'capture');
});

test('classifyMessage rejects empty text', async () => {
  await assert.rejects(classifyMessage({ client: fakeClient('capture'), model: 'm', text: '' }), /text/i);
});

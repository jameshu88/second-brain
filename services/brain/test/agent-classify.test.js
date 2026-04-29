const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMessage } = require('../src/agent/classify');

test('classifyMessage returns capture for any text in slice 2', async () => {
  const out = await classifyMessage({ text: 'rep counter via pose estimation' });
  assert.equal(out, 'capture');
});

test('classifyMessage returns capture even for question-shaped text in slice 2', async () => {
  const out = await classifyMessage({ text: 'what is on my calendar tomorrow?' });
  assert.equal(out, 'capture');
});

test('classifyMessage rejects empty text', async () => {
  await assert.rejects(classifyMessage({ text: '' }), /text/i);
});

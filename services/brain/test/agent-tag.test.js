const test = require('node:test');
const assert = require('node:assert/strict');
const { tagCapture } = require('../src/agent/tag');

function fakeClientReturning(toolInput) {
  return {
    messages: {
      create: async () => ({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 't1', name: 'save_tags', input: toolInput },
        ],
      }),
    },
  };
}

test('tagCapture returns parsed fields from save_tags tool call', async () => {
  const client = fakeClientReturning({
    type: 'idea',
    tags: ['pose-estimation', 'formlab'],
    mentions: ['[[FormLab AI]]'],
    summary: 'Idea to detect rep counting via pose estimation.',
    suggested_para: '01_Projects/FormLab AI',
  });
  const out = await tagCapture({
    client,
    model: 'claude-haiku-4-5-20251001',
    text: 'rep counter via pose estimation',
    entities: { projects: ['FormLab AI'], areas: [], people: [], entities: [], flat: ['FormLab AI'] },
  });
  assert.equal(out.type, 'idea');
  assert.deepEqual(out.tags, ['pose-estimation', 'formlab']);
  assert.deepEqual(out.mentions, ['[[FormLab AI]]']);
  assert.match(out.summary, /pose estimation/i);
  assert.equal(out.suggested_para, '01_Projects/FormLab AI');
});

test('tagCapture filters mentions not in entities.flat', async () => {
  const client = fakeClientReturning({
    type: 'idea',
    tags: [],
    mentions: ['[[FormLab AI]]', '[[InventedThing]]'],
    summary: 's',
    suggested_para: '00_Inbox',
  });
  const out = await tagCapture({
    client,
    model: 'm',
    text: 't',
    entities: { projects: ['FormLab AI'], areas: [], people: [], entities: [], flat: ['FormLab AI'] },
  });
  assert.deepEqual(out.mentions, ['[[FormLab AI]]']);
});

test('tagCapture rejects an invalid type', async () => {
  const client = fakeClientReturning({
    type: 'random_garbage',
    tags: [],
    mentions: [],
    summary: 's',
    suggested_para: '00_Inbox',
  });
  await assert.rejects(
    tagCapture({
      client,
      model: 'm',
      text: 't',
      entities: { projects: [], areas: [], people: [], entities: [], flat: [] },
    }),
    /type/i
  );
});

test('tagCapture rejects suggested_para outside known PARA roots', async () => {
  const client = fakeClientReturning({
    type: 'idea',
    tags: [],
    mentions: [],
    summary: 's',
    suggested_para: '../etc',
  });
  await assert.rejects(
    tagCapture({
      client,
      model: 'm',
      text: 't',
      entities: { projects: [], areas: [], people: [], entities: [], flat: [] },
    }),
    /suggested_para/i
  );
});

test('tagCapture surfaces upstream errors so caller can fall back', async () => {
  const client = {
    messages: {
      create: async () => { throw new Error('upstream 500'); },
    },
  };
  await assert.rejects(
    tagCapture({
      client,
      model: 'm',
      text: 't',
      entities: { projects: [], areas: [], people: [], entities: [], flat: [] },
    }),
    /upstream 500/
  );
});

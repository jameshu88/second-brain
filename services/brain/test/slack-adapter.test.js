const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { buildHandlers } = require('../src/slack/adapter');
const { _setPathOverride } = require('../src/state/threads');

async function tmpVault() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-slack-'));
}

async function tmpStateDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-state-'));
}

function fakeAnthropicTagOnly(toolInput) {
  return {
    messages: {
      create: async () => ({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'save_tags', input: toolInput }],
      }),
    },
  };
}

function fakeAnthropicScripted(scripts) {
  let i = 0;
  return {
    messages: {
      create: async () => {
        const next = scripts[i];
        i += 1;
        if (!next) throw new Error('exhausted scripts');
        return next;
      },
    },
  };
}

const stubEntities = { projects: ['FormLab AI'], areas: [], people: [], entities: [], flat: ['FormLab AI'] };

function makeBuilder(opts = {}) {
  const tagInput = opts.tagInput || {
    type: 'idea',
    tags: ['x'],
    mentions: [],
    summary: 's',
    suggested_para: '00_Inbox',
  };
  return {
    vaultPath: opts.vaultPath,
    allowedUserIds: opts.allowedUserIds || [],
    anthropic: {
      classifyClient: opts.classifyClient || fakeAnthropicScripted([
        { content: [{ type: 'tool_use', name: 'classify', input: { verdict: opts.verdict || 'capture' } }] },
      ]),
      classifyModel: 'haiku',
      tagClient: opts.tagClient || fakeAnthropicTagOnly(tagInput),
      tagModel: 'haiku',
      chatClient: opts.chatClient || fakeAnthropicScripted([
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'reply text' }] },
      ]),
      chatModel: 'sonnet',
    },
    scanEntities: async () => stubEntities,
    googleCalendar: opts.googleCalendar || null,
    botUserId: opts.botUserId || 'UBOT',
    timezone: 'America/Los_Angeles',
    defaultCalendarIds: ['primary'],
    hydrateThread: async () => [],
  };
}

test('capture path: classifier=capture writes file and acks with tag info', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, verdict: 'capture' }));
  await handlers.onMessage({
    message: { channel: 'D1', channel_type: 'im', user: 'U1', text: 'rep counter idea', ts: '1' },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  const files = await fs.readdir(path.join(vault, '00_Inbox'));
  assert.equal(files.length, 1);
  assert.match(acks[0].text, /Saved as idea/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('question path: classifier=question runs chat and posts reply (no capture)', async () => {
  const vault = await tmpVault();
  const stateDir = await tmpStateDir();
  _setPathOverride(path.join(stateDir, 'threads.json'));
  const acks = [];
  const handlers = buildHandlers(makeBuilder({
    vaultPath: vault,
    classifyClient: fakeAnthropicScripted([
      { content: [{ type: 'tool_use', name: 'classify', input: { verdict: 'question' } }] },
    ]),
    chatClient: fakeAnthropicScripted([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'no matches in your vault' }] },
    ]),
  }));
  await handlers.onMessage({
    message: { channel: 'D1', channel_type: 'im', user: 'U1', text: 'find safe notes', ts: '1' },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  assert.equal(acks.length, 1);
  assert.match(acks[0].text, /no matches/);
  await fs.rm(vault, { recursive: true, force: true });
  await fs.rm(stateDir, { recursive: true, force: true });
});

test('both path: classifier=both writes file then runs chat (two acks)', async () => {
  const vault = await tmpVault();
  const stateDir = await tmpStateDir();
  _setPathOverride(path.join(stateDir, 'threads.json'));
  const acks = [];
  const handlers = buildHandlers(makeBuilder({
    vaultPath: vault,
    classifyClient: fakeAnthropicScripted([
      { content: [{ type: 'tool_use', name: 'classify', input: { verdict: 'both' } }] },
    ]),
    chatClient: fakeAnthropicScripted([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'related to formlab' }] },
    ]),
  }));
  await handlers.onMessage({
    message: { channel: 'D1', channel_type: 'im', user: 'U1', text: 'idea X — does this match Y', ts: '1' },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  const files = await fs.readdir(path.join(vault, '00_Inbox'));
  assert.equal(files.length, 1);
  assert.equal(acks.length, 2);
  assert.match(acks[0].text, /Saved as/);
  assert.match(acks[1].text, /related to formlab/);
  await fs.rm(vault, { recursive: true, force: true });
  await fs.rm(stateDir, { recursive: true, force: true });
});

test('confirm gate: y reply fires pending event and skips classify', async () => {
  const vault = await tmpVault();
  const stateDir = await tmpStateDir();
  _setPathOverride(path.join(stateDir, 'threads.json'));
  const { setPending } = require('../src/state/threads');
  await setPending('t1', { kind: 'create_event', args: { title: 'X', start: 'a', end: 'b', calendarId: 'primary' } });
  const acks = [];
  const cal = { events: { insert: async () => ({ data: { id: 'ev', htmlLink: 'https://link' } }) } };
  const handlers = buildHandlers(makeBuilder({
    vaultPath: vault,
    googleCalendar: cal,
    classifyClient: { messages: { create: async () => { throw new Error('classifier should not fire'); } } },
  }));
  await handlers.onMessage({
    message: { channel: 'D1', channel_type: 'im', user: 'U1', text: 'y', ts: '2', thread_ts: 't1' },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  assert.equal(acks.length, 1);
  assert.match(acks[0].text, /Created/);
  assert.match(acks[0].text, /https:\/\/link/);
  await fs.rm(vault, { recursive: true, force: true });
  await fs.rm(stateDir, { recursive: true, force: true });
});

test('disallowed user: no capture, no chat, no ack', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, allowedUserIds: ['U1'] }));
  await handlers.onMessage({
    message: { channel: 'D1', channel_type: 'im', user: 'U_BAD', text: 'hi', ts: '1' },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  assert.equal(acks.length, 0);
  await fs.rm(vault, { recursive: true, force: true });
});

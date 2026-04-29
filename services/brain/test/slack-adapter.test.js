const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { buildHandlers } = require('../src/slack/adapter');

async function tmpVault() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-slack-'));
}

function fakeAnthropic(toolInput) {
  return {
    messages: {
      create: async () => ({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'save_tags', input: toolInput }],
      }),
    },
  };
}

const stubEntities = { projects: ['FormLab AI'], areas: [], people: [], entities: [], flat: ['FormLab AI'] };

function makeBuilder(opts = {}) {
  const tagInput = opts.tagInput || {
    type: 'idea',
    tags: ['pose-estimation'],
    mentions: ['[[FormLab AI]]'],
    summary: 'Idea about pose estimation.',
    suggested_para: '01_Projects/FormLab AI',
  };
  const client = opts.failTag
    ? { messages: { create: async () => { throw new Error('tag pass died'); } } }
    : fakeAnthropic(tagInput);
  return {
    vaultPath: opts.vaultPath,
    allowedUserIds: opts.allowedUserIds || [],
    anthropic: { client, model: 'claude-haiku-4-5-20251001' },
    scanEntities: async () => stubEntities,
  };
}

test('DM handler writes capture, tags it, and posts ack with tag info', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, allowedUserIds: ['U1'] }));
  await handlers.onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      user: 'U1',
      text: 'rep counter via pose estimation',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  const inbox = path.join(vault, '00_Inbox');
  const files = await fs.readdir(inbox);
  assert.equal(files.length, 1);
  const content = await fs.readFile(path.join(inbox, files[0]), 'utf8');
  assert.match(content, /type: idea/);
  assert.match(content, /pose-estimation/);
  assert.match(content, /\[\[FormLab AI\]\]/);
  assert.match(content, /summary: /);
  assert.match(content, /suggested_para: /);
  assert.equal(acks.length, 1);
  assert.match(acks[0].text, /Saved as idea/);
  assert.match(acks[0].text, /pose-estimation/);
  assert.match(acks[0].text, /\[\[FormLab AI\]\]/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('DM handler still saves and acks gracefully when tag pass fails', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, allowedUserIds: [], failTag: true }));
  await handlers.onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      user: 'U1',
      text: 'fragment thought',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  const files = await fs.readdir(path.join(vault, '00_Inbox'));
  assert.equal(files.length, 1);
  const content = await fs.readFile(path.join(vault, '00_Inbox', files[0]), 'utf8');
  assert.match(content, /source: slack/);
  assert.doesNotMatch(content, /^type:/m);
  assert.equal(acks.length, 1);
  assert.match(acks[0].text, /Saved \(tagging unavailable\)/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('DM handler ignores disallowed user (no capture, no ack)', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, allowedUserIds: ['U1'] }));
  await handlers.onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      user: 'U_BAD',
      text: 'hi',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  assert.equal(acks.length, 0);
  await fs.rm(vault, { recursive: true, force: true });
});

test('DM handler ignores bot messages', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, allowedUserIds: [] }));
  await handlers.onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      bot_id: 'B1',
      text: 'pong',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  assert.equal(acks.length, 0);
  await fs.rm(vault, { recursive: true, force: true });
});

test('app_mention handler strips leading mention, captures, tags, and acks', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, allowedUserIds: [] }));
  await handlers.onAppMention({
    event: {
      channel: 'C1',
      user: 'U1',
      text: '<@UBOT> idea: pose detection',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  const files = await fs.readdir(path.join(vault, '00_Inbox'));
  assert.equal(files.length, 1);
  const contents = await fs.readFile(path.join(vault, '00_Inbox', files[0]), 'utf8');
  assert.match(contents, /idea: pose detection/);
  assert.doesNotMatch(contents, /<@UBOT>/);
  assert.equal(acks.length, 1);
  await fs.rm(vault, { recursive: true, force: true });
});

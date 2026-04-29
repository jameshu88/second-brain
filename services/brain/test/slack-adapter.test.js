const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { buildHandlers } = require('../src/slack/adapter');

async function tmpVault() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-slack-'));
}

test('DM handler writes capture for allowed user', async () => {
  const vault = await tmpVault();
  const { onMessage } = buildHandlers({ vaultPath: vault, allowedUserIds: ['U1'] });
  const calls = [];
  await onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      user: 'U1',
      text: 'hello brain',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async (a) => { calls.push(a); } } },
    logger: { warn: () => {}, error: () => {} },
  });
  const inbox = path.join(vault, '00_Inbox');
  const files = await fs.readdir(inbox);
  assert.equal(files.length, 1);
  await fs.rm(vault, { recursive: true, force: true });
});

test('DM handler ignores disallowed user', async () => {
  const vault = await tmpVault();
  const { onMessage } = buildHandlers({ vaultPath: vault, allowedUserIds: ['U1'] });
  await onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      user: 'U_BAD',
      text: 'hi',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async () => {} } },
    logger: { warn: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  await fs.rm(vault, { recursive: true, force: true });
});

test('DM handler ignores bot messages', async () => {
  const vault = await tmpVault();
  const { onMessage } = buildHandlers({ vaultPath: vault, allowedUserIds: [] });
  await onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      bot_id: 'B1',
      text: 'pong',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async () => {} } },
    logger: { warn: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  await fs.rm(vault, { recursive: true, force: true });
});

test('app_mention handler strips leading mention and writes capture', async () => {
  const vault = await tmpVault();
  const { onAppMention } = buildHandlers({ vaultPath: vault, allowedUserIds: [] });
  await onAppMention({
    event: {
      channel: 'C1',
      user: 'U1',
      text: '<@UBOT> idea: pose detection',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async () => {} } },
    logger: { warn: () => {}, error: () => {} },
  });
  const files = await fs.readdir(path.join(vault, '00_Inbox'));
  assert.equal(files.length, 1);
  const contents = await fs.readFile(path.join(vault, '00_Inbox', files[0]), 'utf8');
  assert.match(contents, /idea: pose detection/);
  assert.doesNotMatch(contents, /<@UBOT>/);
  await fs.rm(vault, { recursive: true, force: true });
});

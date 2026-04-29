const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { writeCapture, formatTimestamp, slackTsToDate } = require('../src/capture/writeInbox');

async function tmpVault() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-cap-'));
}

test('formatTimestamp pads UTC components', () => {
  assert.equal(formatTimestamp(new Date(Date.UTC(2026, 3, 5, 7, 9, 3))), '2026-04-05 070903');
});

test('slackTsToDate handles standard slack ts', () => {
  const d = slackTsToDate('1746000000.123456');
  assert.equal(d.getUTCFullYear(), 2025);
});

test('writeCapture writes file to 00_Inbox with required frontmatter', async () => {
  const vault = await tmpVault();
  const filePath = await writeCapture({
    vaultPath: vault,
    text: 'hello world',
    userId: 'U123',
    ts: '1746000000.000000',
    channelType: 'dm',
    channelId: 'D456',
  });
  assert.ok(filePath.includes('/00_Inbox/'));
  const content = await fs.readFile(filePath, 'utf8');
  assert.match(content, /^---\n/);
  assert.match(content, /source: slack/);
  assert.match(content, /status: inbox/);
  assert.match(content, /channel_type: dm/);
  assert.match(content, /slack_user: U123/);
  assert.match(content, /slack_channel: D456/);
  assert.match(content, /\nhello world\n/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('writeCapture appends suffix on collision', async () => {
  const vault = await tmpVault();
  const args = {
    vaultPath: vault,
    text: 'first',
    userId: 'U1',
    ts: '1746000000.000000',
    channelType: 'dm',
    channelId: 'D1',
  };
  const a = await writeCapture(args);
  const b = await writeCapture({ ...args, text: 'second' });
  assert.notEqual(a, b);
  assert.ok(b.endsWith('(2).md') || b.endsWith('(1).md'));
  await fs.rm(vault, { recursive: true, force: true });
});

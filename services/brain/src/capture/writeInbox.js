const fs = require('node:fs/promises');
const path = require('node:path');
const { writeNote } = require('../tools/writeNote');

async function writeCapture({ vaultPath, text, userId, ts, channelType, channelId }) {
  const date = slackTsToDate(ts);
  const stamp = formatTimestamp(date);
  const baseName = `${stamp} - slack`;

  const inboxDir = path.join(vaultPath, '00_Inbox');
  let chosen = `${baseName}.md`;
  let n = 1;
  while (await fileExists(path.join(inboxDir, chosen))) {
    n += 1;
    chosen = `${baseName} (${n}).md`;
  }

  const frontmatter = {
    created: date.toISOString(),
    source: 'slack',
    channel_type: channelType,
    status: 'inbox',
    slack_user: userId,
  };
  if (channelId) {
    frontmatter.slack_channel = channelId;
  }

  return writeNote({
    vaultPath,
    relPath: path.posix.join('00_Inbox', chosen),
    frontmatter,
    body: `${text.trim()}\n`,
  });
}

function slackTsToDate(ts) {
  const sec = parseFloat(String(ts));
  return new Date(sec * 1000);
}

function formatTimestamp(d) {
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${y}-${m}-${day} ${h}${min}${s}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

module.exports = { writeCapture, formatTimestamp, slackTsToDate };

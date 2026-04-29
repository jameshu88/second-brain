const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { readNote } = require('../src/tools/readNote');

async function tmpVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-rd-'));
  await fs.mkdir(path.join(dir, '00_Inbox'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '00_Inbox/n.md'),
    `---\ncreated: 2026-04-01T00:00:00.000Z\nstatus: inbox\n---\nbody text\n`
  );
  return dir;
}

test('readNote returns body and parsed frontmatter', async () => {
  const vault = await tmpVault();
  const out = await readNote({ vaultPath: vault, relPath: '00_Inbox/n.md' });
  assert.equal(out.frontmatter.status, 'inbox');
  assert.match(out.body, /body text/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('readNote rejects path traversal', async () => {
  const vault = await tmpVault();
  await assert.rejects(readNote({ vaultPath: vault, relPath: '../escape.md' }), /outside vault/i);
  await fs.rm(vault, { recursive: true, force: true });
});

test('readNote returns null when file does not exist', async () => {
  const vault = await tmpVault();
  const out = await readNote({ vaultPath: vault, relPath: '00_Inbox/missing.md' });
  assert.equal(out, null);
  await fs.rm(vault, { recursive: true, force: true });
});

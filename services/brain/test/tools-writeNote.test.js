const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { writeNote } = require('../src/tools/writeNote');

async function tmpVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-test-'));
  await fs.mkdir(path.join(dir, '00_Inbox'), { recursive: true });
  return dir;
}

test('writeNote creates file with frontmatter and body', async () => {
  const vault = await tmpVault();
  const out = await writeNote({
    vaultPath: vault,
    relPath: '00_Inbox/test.md',
    frontmatter: { created: '2026-04-29T00:00:00.000Z', status: 'inbox' },
    body: 'hello\n',
  });
  const content = await fs.readFile(out, 'utf8');
  assert.match(content, /^---\n/);
  assert.match(content, /status: inbox/);
  assert.ok(content.endsWith('hello\n'));
  await fs.rm(vault, { recursive: true, force: true });
});

test('writeNote refuses overwrite by default', async () => {
  const vault = await tmpVault();
  const rel = '00_Inbox/dupe.md';
  await writeNote({ vaultPath: vault, relPath: rel, frontmatter: { a: 1 }, body: 'x\n' });
  await assert.rejects(
    writeNote({ vaultPath: vault, relPath: rel, frontmatter: { a: 1 }, body: 'x\n' }),
    /exists/i
  );
  await fs.rm(vault, { recursive: true, force: true });
});

test('writeNote with overwrite:true merges frontmatter and replaces body', async () => {
  const vault = await tmpVault();
  const rel = '00_Inbox/merge.md';
  await writeNote({
    vaultPath: vault,
    relPath: rel,
    frontmatter: { created: 't', status: 'inbox', custom: 'keep' },
    body: 'first\n',
  });
  await writeNote({
    vaultPath: vault,
    relPath: rel,
    frontmatter: { status: 'active', new_field: 1 },
    body: 'second\n',
    overwrite: true,
  });
  const content = await fs.readFile(path.join(vault, rel), 'utf8');
  assert.match(content, /status: active/);
  assert.match(content, /custom: keep/);
  assert.match(content, /new_field: 1/);
  assert.ok(content.endsWith('second\n'));
  await fs.rm(vault, { recursive: true, force: true });
});

test('writeNote rejects path traversal', async () => {
  const vault = await tmpVault();
  await assert.rejects(
    writeNote({
      vaultPath: vault,
      relPath: '../escape.md',
      frontmatter: {},
      body: 'x',
    }),
    /outside vault/i
  );
  await fs.rm(vault, { recursive: true, force: true });
});

test('writeNote leaves no .tmp file on success', async () => {
  const vault = await tmpVault();
  await writeNote({
    vaultPath: vault,
    relPath: '00_Inbox/atomic.md',
    frontmatter: {},
    body: 'x\n',
  });
  const entries = await fs.readdir(path.join(vault, '00_Inbox'));
  assert.deepEqual(entries.filter((e) => e.endsWith('.tmp')), []);
  await fs.rm(vault, { recursive: true, force: true });
});

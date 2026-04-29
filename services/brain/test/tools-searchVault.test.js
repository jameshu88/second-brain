const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { searchVault } = require('../src/tools/searchVault');

async function buildFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-srch-'));
  await fs.mkdir(path.join(dir, '01_Projects/FormLab AI'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '01_Projects/FormLab AI/idea.md'),
    `---\ncreated: 2026-04-01T00:00:00.000Z\nstatus: active\ntype: idea\n---\n\nrep counter via pose estimation\n`
  );
  await fs.mkdir(path.join(dir, '00_Inbox'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '00_Inbox/old.md'),
    `---\ncreated: 2026-03-01T00:00:00.000Z\nstatus: inbox\n---\n\nnotes about safes\n`
  );
  const past = new Date('2026-03-01T00:00:00Z');
  await fs.utimes(path.join(dir, '00_Inbox/old.md'), past, past);
  return dir;
}

test('searchVault returns hits with snippets and frontmatter', async () => {
  const vault = await buildFixture();
  const hits = await searchVault({ vaultPath: vault, query: 'pose' });
  assert.ok(hits.length >= 1);
  const h = hits[0];
  assert.match(h.path, /idea\.md$/);
  assert.match(h.snippet, /pose/);
  assert.equal(h.frontmatter.type, 'idea');
  assert.ok(typeof h.line === 'number');
  assert.ok(h.mtime instanceof Date || typeof h.mtime === 'string');
  await fs.rm(vault, { recursive: true, force: true });
});

test('searchVault returns empty array when no matches', async () => {
  const vault = await buildFixture();
  const hits = await searchVault({ vaultPath: vault, query: 'xyzzy_no_match' });
  assert.deepEqual(hits, []);
  await fs.rm(vault, { recursive: true, force: true });
});

test('searchVault sorts hits by file mtime desc', async () => {
  const vault = await buildFixture();
  const shared = await searchVault({ vaultPath: vault, query: 'status' });
  assert.ok(shared.length >= 2);
  for (let i = 1; i < shared.length; i++) {
    const a = new Date(shared[i - 1].mtime).getTime();
    const b = new Date(shared[i].mtime).getTime();
    assert.ok(a >= b, `expected mtime desc; got ${a} < ${b}`);
  }
  await fs.rm(vault, { recursive: true, force: true });
});

test('searchVault handles path-traversal-shaped queries safely', async () => {
  const vault = await buildFixture();
  const hits = await searchVault({ vaultPath: vault, query: '../etc/passwd' });
  assert.deepEqual(hits, []);
  await fs.rm(vault, { recursive: true, force: true });
});

test('searchVault caps results at 50', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-srch-cap-'));
  await fs.mkdir(path.join(vault, '00_Inbox'), { recursive: true });
  for (let i = 0; i < 60; i++) {
    await fs.writeFile(path.join(vault, `00_Inbox/n${i}.md`), `marker${i} marker\n`);
  }
  const hits = await searchVault({ vaultPath: vault, query: 'marker' });
  assert.ok(hits.length <= 50);
  await fs.rm(vault, { recursive: true, force: true });
});

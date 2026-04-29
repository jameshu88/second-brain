const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { scanEntities, _resetCache } = require('../src/util/entities');

async function buildFixtureVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-ent-'));
  await fs.mkdir(path.join(dir, '01_Projects/FormLab AI'), { recursive: true });
  await fs.mkdir(path.join(dir, '01_Projects/Empty'), { recursive: true });
  await fs.mkdir(path.join(dir, '02_Areas/Engineering'), { recursive: true });
  await fs.mkdir(path.join(dir, '02_Areas/Music'), { recursive: true });
  await fs.mkdir(path.join(dir, '05_People'), { recursive: true });
  await fs.writeFile(path.join(dir, '05_People/James.md'), '');
  await fs.writeFile(path.join(dir, '05_People/Friend.md'), '');
  await fs.mkdir(path.join(dir, '06_Entities'), { recursive: true });
  await fs.writeFile(path.join(dir, '06_Entities/Acme Corp.md'), '');
  return dir;
}

test('scanEntities returns projects, areas, people, entities', async () => {
  _resetCache();
  const vault = await buildFixtureVault();
  const ents = await scanEntities(vault);
  assert.deepEqual(ents.projects.sort(), ['Empty', 'FormLab AI']);
  assert.deepEqual(ents.areas.sort(), ['Engineering', 'Music']);
  assert.deepEqual(ents.people.sort(), ['Friend', 'James']);
  assert.deepEqual(ents.entities.sort(), ['Acme Corp']);
  await fs.rm(vault, { recursive: true, force: true });
});

test('scanEntities skips non-existent PARA folders without throwing', async () => {
  _resetCache();
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-ent-'));
  const ents = await scanEntities(vault);
  assert.deepEqual(ents, { projects: [], areas: [], people: [], entities: [], flat: [] });
  await fs.rm(vault, { recursive: true, force: true });
});

test('scanEntities caches results within TTL', async () => {
  _resetCache();
  const vault = await buildFixtureVault();
  const a = await scanEntities(vault);
  await fs.mkdir(path.join(vault, '01_Projects/NewProj'), { recursive: true });
  const b = await scanEntities(vault);
  assert.deepEqual(b.projects.sort(), a.projects.sort());
  await fs.rm(vault, { recursive: true, force: true });
});

test('scanEntities re-scans after _resetCache', async () => {
  _resetCache();
  const vault = await buildFixtureVault();
  await scanEntities(vault);
  await fs.mkdir(path.join(vault, '01_Projects/NewProj'), { recursive: true });
  _resetCache();
  const b = await scanEntities(vault);
  assert.ok(b.projects.includes('NewProj'));
  await fs.rm(vault, { recursive: true, force: true });
});

test('scanEntities returns flat list helper for prompt embedding', async () => {
  _resetCache();
  const vault = await buildFixtureVault();
  const ents = await scanEntities(vault);
  assert.ok(Array.isArray(ents.flat));
  assert.ok(ents.flat.includes('FormLab AI'));
  assert.ok(ents.flat.includes('James'));
  assert.ok(ents.flat.includes('Acme Corp'));
  await fs.rm(vault, { recursive: true, force: true });
});

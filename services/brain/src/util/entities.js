const fs = require('node:fs/promises');
const path = require('node:path');

const TTL_MS = parseInt(process.env.ENTITY_CACHE_TTL_MS || '3600000', 10) || 3600000;

let cache = null; // { vaultPath, expires, value }

async function scanEntities(vaultPath) {
  const now = Date.now();
  if (cache && cache.vaultPath === vaultPath && cache.expires > now) {
    return cache.value;
  }
  const [projects, areas, people, entities] = await Promise.all([
    listSubdirs(path.join(vaultPath, '01_Projects')),
    listSubdirs(path.join(vaultPath, '02_Areas')),
    listMarkdownStems(path.join(vaultPath, '05_People')),
    listMarkdownStems(path.join(vaultPath, '06_Entities')),
  ]);
  const flat = [...projects, ...areas, ...people, ...entities];
  const value = { projects, areas, people, entities, flat };
  cache = { vaultPath, expires: now + TTL_MS, value };
  return value;
}

async function listSubdirs(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listMarkdownStems(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name.replace(/\.md$/, ''));
  } catch {
    return [];
  }
}

function _resetCache() {
  cache = null;
}

module.exports = { scanEntities, _resetCache };

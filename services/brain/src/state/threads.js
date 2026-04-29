const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PATH = path.resolve(__dirname, '../../.state/threads.json');

let pathOverride = null;

function _setPathOverride(p) {
  pathOverride = p;
}

function statePath() {
  return pathOverride || DEFAULT_PATH;
}

async function readAll() {
  try {
    const raw = await fs.readFile(statePath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeAll(map) {
  const file = statePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

async function setPending(threadTs, action, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const all = await readAll();
  all[threadTs] = { ...action, expiresAt: Date.now() + ttlMs };
  await writeAll(all);
}

async function getPending(threadTs) {
  const all = await readAll();
  const entry = all[threadTs];
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    delete all[threadTs];
    await writeAll(all);
    return null;
  }
  return entry;
}

async function clearPending(threadTs) {
  const all = await readAll();
  if (all[threadTs]) {
    delete all[threadTs];
    await writeAll(all);
  }
}

module.exports = { setPending, getPending, clearPending, _setPathOverride };

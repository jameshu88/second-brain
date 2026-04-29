const fs = require('node:fs/promises');
const { safeJoin } = require('../util/paths');
const { parse } = require('../util/frontmatter');

async function readNote({ vaultPath, relPath }) {
  const abs = safeJoin(vaultPath, relPath);
  let raw;
  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const { frontmatter, body } = parse(raw);
  return { frontmatter, body };
}

module.exports = { readNote };

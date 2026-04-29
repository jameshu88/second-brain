const fs = require('node:fs/promises');
const path = require('node:path');
const { safeJoin } = require('../util/paths');
const { parse, merge, serialize } = require('../util/frontmatter');

/**
 * Write a markdown note safely.
 *
 * Behavior:
 *  - Path is joined via safeJoin (refuses traversal/absolute paths).
 *  - Parent directory is created if missing.
 *  - With overwrite=false (default): refuses if the file already exists.
 *  - With overwrite=true: reads the existing file, merges its frontmatter
 *    with the new frontmatter (override wins), replaces the body.
 *  - Writes to <path>.tmp then renames; readers never see partial files.
 */
async function writeNote({ vaultPath, relPath, frontmatter, body, overwrite = false }) {
  const abs = safeJoin(vaultPath, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });

  let finalFrontmatter = frontmatter;
  if (await exists(abs)) {
    if (!overwrite) {
      throw new Error(`writeNote: file exists: ${relPath}`);
    }
    const existing = await fs.readFile(abs, 'utf8');
    const { frontmatter: existingFm } = parse(existing);
    finalFrontmatter = merge(existingFm, frontmatter);
  }

  const text = serialize(finalFrontmatter, body);
  const tmp = `${abs}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, abs);
  return abs;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

module.exports = { writeNote };

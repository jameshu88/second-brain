const path = require('node:path');

/**
 * Join a vault-relative path onto the vault root, refusing anything that
 * would escape the vault or that came in as absolute.
 *
 * @param {string} vaultPath Absolute path to vault root.
 * @param {string} relPath   Vault-relative path (must not start with '/' or '~').
 * @returns {string} Absolute, normalized path guaranteed to live under vaultPath.
 */
function safeJoin(vaultPath, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error('safeJoin: empty relative path');
  }
  if (relPath.startsWith('/') || relPath.startsWith('~')) {
    throw new Error(`safeJoin: refusing absolute path "${relPath}"`);
  }
  // Decode percent-encoding so e.g. ..%2F becomes ../ before resolution.
  let decoded;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    decoded = relPath;
  }
  const absVault = path.resolve(vaultPath);
  const joined = path.resolve(absVault, decoded);
  const rel = path.relative(absVault, joined);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`safeJoin: path "${relPath}" resolves outside vault`);
  }
  return joined;
}

module.exports = { safeJoin };

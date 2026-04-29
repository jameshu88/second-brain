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
  // If decoding fails (malformed input), keep the raw string — path.relative
  // will then either accept it as a literal filename or reject it as an escape.
  let decoded;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    decoded = relPath;
  }
  if (decoded.includes('\x00')) {
    throw new Error(`safeJoin: null byte in path "${relPath}"`);
  }
  const absVault = path.resolve(vaultPath);
  const joined = path.resolve(absVault, decoded);
  const rel = path.relative(absVault, joined);
  // path.isAbsolute(rel) is portability insurance for Windows. On POSIX,
  // path.relative always returns a relative path, so this branch is dead;
  // on Windows, an unrelated drive letter could surface as absolute.
  // Aside: on POSIX, '\' is a literal filename character (not a separator),
  // so paths like 'a\\..\\b' are treated as a weird single filename rather
  // than a traversal. On Windows that would be a real escape.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`safeJoin: path "${relPath}" resolves outside vault`);
  }
  return joined;
}

module.exports = { safeJoin };

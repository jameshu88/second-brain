const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parse } = require('../util/frontmatter');

const MAX_HITS = 50;

async function searchVault({ vaultPath, query }) {
  if (!query || typeof query !== 'string') {
    return [];
  }
  const lines = await runRipgrep(vaultPath, query);
  if (lines.length === 0) return [];

  const byPath = new Map();
  for (const ln of lines) {
    const m = ln.match(/^(.+?):(\d+):(.*)$/);
    if (!m) continue;
    const filePath = m[1];
    const lineNo = parseInt(m[2], 10);
    const snippet = m[3];
    if (!byPath.has(filePath)) {
      byPath.set(filePath, []);
    }
    byPath.get(filePath).push({ line: lineNo, snippet });
  }

  const hits = [];
  for (const [filePath, occurrences] of byPath) {
    let frontmatter = {};
    let mtime = null;
    try {
      const content = await fs.readFile(filePath, 'utf8');
      frontmatter = parse(content).frontmatter;
      const stat = await fs.stat(filePath);
      mtime = stat.mtime;
    } catch {}
    const first = occurrences[0];
    hits.push({
      path: path.relative(vaultPath, filePath),
      line: first.line,
      snippet: first.snippet,
      frontmatter,
      mtime,
    });
  }

  hits.sort((a, b) => {
    const ta = a.mtime ? new Date(a.mtime).getTime() : 0;
    const tb = b.mtime ? new Date(b.mtime).getTime() : 0;
    return tb - ta;
  });

  return hits.slice(0, MAX_HITS);
}

function runRipgrep(vaultPath, query) {
  return new Promise((resolve) => {
    const args = ['--no-heading', '-n', '-i', '--max-count', '5', '--', query, vaultPath];
    const proc = spawn('rg', args);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => resolve([])); // rg not installed → empty
    proc.on('close', () => {
      const lines = out.split('\n').filter(Boolean);
      resolve(lines);
    });
  });
}

module.exports = { searchVault };

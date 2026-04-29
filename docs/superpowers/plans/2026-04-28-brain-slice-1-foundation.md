# Conversational Brain — Slice 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `services/slack-ingest/` with a `services/brain/` modular monolith. Switch Slack transport to Socket Mode (no ngrok). Run as a macOS LaunchAgent. Add a `brain:doctor` health check. Capture functionality remains identical to today's behavior; the brain becomes the foundation for later slices (tagging, chat, status synthesis, calendar, batch).

**Architecture:** Node 18+ modular monolith under `services/brain/`. Pure-function tools (`tools/`) called by Slack adapter and (later) batch jobs. Atomic, path-safe filesystem writes via `util/paths.js` + `util/frontmatter.js`. `@slack/bolt` in Socket Mode.

**Tech Stack:** Node 18+, `@slack/bolt` v3, `dotenv`, native `node:test` for tests, `js-yaml` for frontmatter parsing.

**Source spec:** `docs/superpowers/specs/2026-04-28-conversational-brain-design.md`

**Out of scope for this slice:** Anthropic API calls, classification, tagging, chat, status synthesis, Google Calendar, daily batch. These ship in Slices 2-6.

---

### Task 1: Repository scaffold for `services/brain/`

**Files:**
- Create: `services/brain/package.json`
- Create: `services/brain/.env.example`
- Create: `services/brain/.gitignore`
- Create: `services/brain/README.md` (stub)
- Modify: `.gitignore`

- [ ] **Step 1: Create `services/brain/package.json`**

```json
{
  "name": "@second-brain/brain",
  "private": true,
  "version": "0.1.0",
  "description": "Conversational brain for the PARA vault (capture v1)",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test test/",
    "doctor": "node src/cli/doctor.js",
    "check": "node --check src/index.js"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "@slack/bolt": "^3.22.0",
    "dotenv": "^16.4.5",
    "js-yaml": "^4.1.0"
  }
}
```

- [ ] **Step 2: Create `services/brain/.env.example`**

```
# Copy to .env (never commit .env)

# --- Slack (Socket Mode) ---
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-level-token   # required for Socket Mode
SLACK_SIGNING_SECRET=your-signing-secret    # still required even on Socket Mode

# --- Vault ---
# Absolute path to the vault root (must contain 00_Inbox/)
VAULT_PATH=/Users/you/Desktop/2nd Brain/vault

# --- Access control ---
# Comma-separated Slack user IDs allowed to interact with the bot.
# Empty = anyone in the workspace; recommended: set to your own U... id only.
ALLOWED_SLACK_USER_IDS=

# --- Behavior knobs (used by later slices; harmless if blank) ---
TIMEZONE=                        # blank = host TZ
LOG_LEVEL=info
```

- [ ] **Step 3: Create `services/brain/.gitignore`**

```
node_modules/
.env
.state/
```

- [ ] **Step 4: Create `services/brain/README.md` (stub)**

```markdown
# brain

Conversational brain for the PARA vault. Slice 1: capture parity with the
former `slack-ingest` service, running via Slack Socket Mode under macOS
LaunchAgent.

See `docs/superpowers/specs/2026-04-28-conversational-brain-design.md` for
the design and `docs/superpowers/plans/2026-04-28-brain-slice-1-foundation.md`
for the slice plan.

## Setup (Slack)

1. Create a Slack app at https://api.slack.com/apps.
2. Enable **Socket Mode** under the Socket Mode tab and generate an
   app-level token with the `connections:write` scope (`xapp-...`).
3. Bot token scopes (OAuth & Permissions):
   - `app_mentions:read`
   - `im:history`
   - `chat:write`
4. Subscribe to bot events: `app_mention`, `message.im`.
5. Install the app to your workspace; copy the bot token (`xoxb-...`)
   and signing secret.
6. Copy `.env.example` to `.env` and fill in the three Slack values
   plus `VAULT_PATH`.

## Run

\`\`\`bash
cd services/brain
npm install
npm run doctor   # sanity-check env, vault, Slack auth
npm start
\`\`\`

DM the bot or @mention it in a channel; the message saves to
`$VAULT_PATH/00_Inbox/` as a markdown file with frontmatter.
```

- [ ] **Step 5: Update root `.gitignore` to cover brain state**

Modify `.gitignore` — append the following lines (do not remove existing
entries):

```
# brain service
services/brain/.env
services/brain/.state/
services/brain/node_modules/

# brain logs (LaunchAgent writes here on the user's machine)
# (note: these are outside the repo, but listed for reference)
```

- [ ] **Step 6: Commit**

```bash
git add services/brain/package.json services/brain/.env.example \
        services/brain/.gitignore services/brain/README.md .gitignore
git commit -m "brain: scaffold service skeleton"
```

---

### Task 2: `util/paths.js` — path-safe vault joining (TDD)

**Files:**
- Create: `services/brain/test/util-paths.test.js`
- Create: `services/brain/src/util/paths.js`

- [ ] **Step 1: Write the failing tests**

Create `services/brain/test/util-paths.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { safeJoin } = require('../src/util/paths');

const VAULT = '/tmp/vault-fixture';

test('safeJoin returns absolute path inside vault for clean input', () => {
  const out = safeJoin(VAULT, '00_Inbox/note.md');
  assert.equal(out, path.join(VAULT, '00_Inbox/note.md'));
});

test('safeJoin rejects parent traversal', () => {
  assert.throws(() => safeJoin(VAULT, '../etc/passwd'), /outside vault/i);
});

test('safeJoin rejects encoded traversal', () => {
  assert.throws(() => safeJoin(VAULT, '00_Inbox/..%2F..%2Fetc'), /outside vault/i);
});

test('safeJoin rejects absolute relative input', () => {
  assert.throws(() => safeJoin(VAULT, '/etc/passwd'), /absolute/i);
});

test('safeJoin rejects home-prefixed input', () => {
  assert.throws(() => safeJoin(VAULT, '~/secrets'), /absolute|outside vault/i);
});

test('safeJoin allows nested clean paths', () => {
  const out = safeJoin(VAULT, '01_Projects/FormLab AI/sub/note.md');
  assert.equal(out, path.join(VAULT, '01_Projects/FormLab AI/sub/note.md'));
});

test('safeJoin requires non-empty relative path', () => {
  assert.throws(() => safeJoin(VAULT, ''), /empty/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/brain && npm install && npm test`
Expected: FAIL — module `../src/util/paths` not found.

- [ ] **Step 3: Implement `services/brain/src/util/paths.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/brain && npm test`
Expected: All `safeJoin` tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/util/paths.js services/brain/test/util-paths.test.js
git commit -m "brain: add path-safe vault join with tests"
```

---

### Task 3: `util/frontmatter.js` — parse/merge/serialize (TDD)

**Files:**
- Create: `services/brain/test/util-frontmatter.test.js`
- Create: `services/brain/src/util/frontmatter.js`

- [ ] **Step 1: Write the failing tests**

Create `services/brain/test/util-frontmatter.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, merge, serialize, splitDocument } = require('../src/util/frontmatter');

test('parse returns empty frontmatter and full body when no fence', () => {
  const { frontmatter, body } = parse('hello world\n');
  assert.deepEqual(frontmatter, {});
  assert.equal(body, 'hello world\n');
});

test('parse extracts simple frontmatter and body', () => {
  const input = `---\ncreated: 2026-04-29T00:00:00.000Z\nstatus: inbox\n---\nbody text\n`;
  const { frontmatter, body } = parse(input);
  assert.equal(frontmatter.created, '2026-04-29T00:00:00.000Z');
  assert.equal(frontmatter.status, 'inbox');
  assert.equal(body, 'body text\n');
});

test('parse preserves unknown fields', () => {
  const input = `---\ncreated: 2026-04-29T00:00:00.000Z\ncustom_field: 42\n---\n\n`;
  const { frontmatter } = parse(input);
  assert.equal(frontmatter.custom_field, 42);
});

test('merge preserves existing keys not overridden', () => {
  const out = merge({ created: 'a', custom: 'keep' }, { status: 'inbox' });
  assert.deepEqual(out, { created: 'a', custom: 'keep', status: 'inbox' });
});

test('merge override replaces matching keys', () => {
  const out = merge({ status: 'inbox' }, { status: 'active' });
  assert.equal(out.status, 'active');
});

test('serialize produces fenced YAML + body with trailing newline', () => {
  const out = serialize({ created: '2026-04-29T00:00:00.000Z', status: 'inbox' }, 'body\n');
  assert.match(out, /^---\n/);
  assert.match(out, /\ncreated: '?2026-04-29T00:00:00\.000Z'?\n/);
  assert.match(out, /\nstatus: inbox\n/);
  assert.match(out, /\n---\n/);
  assert.ok(out.endsWith('body\n'));
});

test('roundtrip preserves all fields including unknown', () => {
  const fm = { created: '2026-04-29T00:00:00.000Z', source: 'slack', mystery: ['a', 'b'] };
  const round = parse(serialize(fm, 'body\n'));
  assert.deepEqual(round.frontmatter, fm);
  assert.equal(round.body, 'body\n');
});

test('splitDocument returns frontmatter and body strings unchanged when no fence', () => {
  const out = splitDocument('plain text\n');
  assert.equal(out.frontmatterText, '');
  assert.equal(out.body, 'plain text\n');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/brain && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `services/brain/src/util/frontmatter.js`**

```js
const yaml = require('js-yaml');

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split a document into raw frontmatter text and body without parsing.
 * Useful when you want to preserve exact YAML formatting.
 */
function splitDocument(text) {
  const m = text.match(FENCE);
  if (!m) {
    return { frontmatterText: '', body: text };
  }
  return { frontmatterText: m[1], body: text.slice(m[0].length) };
}

/**
 * Parse a markdown document into frontmatter object + body string.
 * If there's no fenced YAML at the top, frontmatter is `{}`.
 */
function parse(text) {
  const { frontmatterText, body } = splitDocument(text);
  if (frontmatterText === '') {
    return { frontmatter: {}, body };
  }
  const fm = yaml.load(frontmatterText) || {};
  if (typeof fm !== 'object' || Array.isArray(fm)) {
    throw new Error('frontmatter: top-level YAML must be a mapping');
  }
  return { frontmatter: fm, body };
}

/**
 * Merge override fields onto base. Override keys win; base keys not present
 * in override are preserved (including unknown ones we don't know about).
 */
function merge(base, override) {
  return { ...base, ...override };
}

/**
 * Serialize a frontmatter object + body back into a fenced markdown document.
 * Uses js-yaml with stable key order (insertion order) and `noRefs` for safety.
 */
function serialize(frontmatter, body) {
  const yamlText = yaml
    .dump(frontmatter, { noRefs: true, lineWidth: 1000, sortKeys: false })
    .trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}

module.exports = { parse, merge, serialize, splitDocument };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/brain && npm test`
Expected: All frontmatter tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/util/frontmatter.js services/brain/test/util-frontmatter.test.js
git commit -m "brain: add frontmatter parse/merge/serialize utility"
```

---

### Task 4: `tools/writeNote.js` — atomic, frontmatter-merging writes (TDD)

**Files:**
- Create: `services/brain/test/tools-writeNote.test.js`
- Create: `services/brain/src/tools/writeNote.js`

- [ ] **Step 1: Write the failing tests**

Create `services/brain/test/tools-writeNote.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/brain && npm test`
Expected: FAIL — module `../src/tools/writeNote` not found.

- [ ] **Step 3: Implement `services/brain/src/tools/writeNote.js`**

```js
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
 *
 * @param {object} args
 * @param {string} args.vaultPath Absolute path to vault root.
 * @param {string} args.relPath   Vault-relative target path.
 * @param {object} args.frontmatter Object to write/merge.
 * @param {string} args.body      Markdown body string (caller provides newline).
 * @param {boolean} [args.overwrite=false]
 * @returns {Promise<string>} Absolute final path written.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/brain && npm test`
Expected: All `writeNote` tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/tools/writeNote.js services/brain/test/tools-writeNote.test.js
git commit -m "brain: add atomic, path-safe writeNote tool"
```

---

### Task 5: `capture/writeInbox.js` — Slack capture writer (TDD)

**Files:**
- Create: `services/brain/test/capture-writeInbox.test.js`
- Create: `services/brain/src/capture/writeInbox.js`

The new writer keeps the same on-disk format as the existing `slack-ingest`,
but routes through `writeNote` for path-safety + atomicity, and is callable
from any code path (Slack adapter today; classifier tomorrow).

- [ ] **Step 1: Write the failing tests**

Create `services/brain/test/capture-writeInbox.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { writeCapture, formatTimestamp, slackTsToDate } = require('../src/capture/writeInbox');

async function tmpVault() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-cap-'));
}

test('formatTimestamp pads UTC components', () => {
  assert.equal(formatTimestamp(new Date(Date.UTC(2026, 3, 5, 7, 9, 3))), '2026-04-05 070903');
});

test('slackTsToDate handles standard slack ts', () => {
  const d = slackTsToDate('1746000000.123456');
  assert.equal(d.getUTCFullYear(), 2025);
});

test('writeCapture writes file to 00_Inbox with required frontmatter', async () => {
  const vault = await tmpVault();
  const filePath = await writeCapture({
    vaultPath: vault,
    text: 'hello world',
    userId: 'U123',
    ts: '1746000000.000000',
    channelType: 'dm',
    channelId: 'D456',
  });
  assert.ok(filePath.includes('/00_Inbox/'));
  const content = await fs.readFile(filePath, 'utf8');
  assert.match(content, /^---\n/);
  assert.match(content, /source: slack/);
  assert.match(content, /status: inbox/);
  assert.match(content, /channel_type: dm/);
  assert.match(content, /slack_user: U123/);
  assert.match(content, /slack_channel: D456/);
  assert.match(content, /\nhello world\n/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('writeCapture appends suffix on collision', async () => {
  const vault = await tmpVault();
  const args = {
    vaultPath: vault,
    text: 'first',
    userId: 'U1',
    ts: '1746000000.000000',
    channelType: 'dm',
    channelId: 'D1',
  };
  const a = await writeCapture(args);
  const b = await writeCapture({ ...args, text: 'second' });
  assert.notEqual(a, b);
  assert.ok(b.endsWith('(2).md') || b.endsWith('(1).md'));
  await fs.rm(vault, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/brain && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `services/brain/src/capture/writeInbox.js`**

```js
const fs = require('node:fs/promises');
const path = require('node:path');
const { writeNote } = require('../tools/writeNote');

/**
 * Persist a Slack message as a capture in 00_Inbox/.
 * Same on-disk shape as the prior slack-ingest service.
 *
 * @param {object} opts
 * @param {string} opts.vaultPath Absolute path to vault root.
 * @param {string} opts.text Message body.
 * @param {string} opts.userId Slack user id.
 * @param {string} opts.ts Slack event timestamp.
 * @param {'dm'|'channel'} opts.channelType
 * @param {string} [opts.channelId]
 * @returns {Promise<string>} Absolute path to the written file.
 */
async function writeCapture({ vaultPath, text, userId, ts, channelType, channelId }) {
  const date = slackTsToDate(ts);
  const stamp = formatTimestamp(date);
  const baseName = `${stamp} - slack`;

  const inboxDir = path.join(vaultPath, '00_Inbox');
  let chosen = `${baseName}.md`;
  let n = 1;
  while (await fileExists(path.join(inboxDir, chosen))) {
    n += 1;
    chosen = `${baseName} (${n}).md`;
  }

  const frontmatter = {
    created: date.toISOString(),
    source: 'slack',
    channel_type: channelType,
    status: 'inbox',
    slack_user: userId,
  };
  if (channelId) {
    frontmatter.slack_channel = channelId;
  }

  return writeNote({
    vaultPath,
    relPath: path.posix.join('00_Inbox', chosen),
    frontmatter,
    body: `${text.trim()}\n`,
  });
}

function slackTsToDate(ts) {
  const sec = parseFloat(String(ts));
  return new Date(sec * 1000);
}

function formatTimestamp(d) {
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${y}-${m}-${day} ${h}${min}${s}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

module.exports = { writeCapture, formatTimestamp, slackTsToDate };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/brain && npm test`
Expected: All capture tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/capture/writeInbox.js services/brain/test/capture-writeInbox.test.js
git commit -m "brain: port slack capture through writeNote"
```

---

### Task 6: `src/config.js` — env loading and validation (TDD)

**Files:**
- Create: `services/brain/test/config.test.js`
- Create: `services/brain/src/config.js`

- [ ] **Step 1: Write the failing tests**

Create `services/brain/test/config.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../src/config');

const BASE = {
  SLACK_BOT_TOKEN: 'xoxb-x',
  SLACK_APP_TOKEN: 'xapp-x',
  SLACK_SIGNING_SECRET: 's',
  VAULT_PATH: '/tmp/some-vault',
};

test('loadConfig returns a normalized config from env', () => {
  const cfg = loadConfig({ ...BASE, ALLOWED_SLACK_USER_IDS: 'U1, U2' });
  assert.equal(cfg.slack.botToken, 'xoxb-x');
  assert.equal(cfg.slack.appToken, 'xapp-x');
  assert.equal(cfg.slack.signingSecret, 's');
  assert.equal(cfg.vaultPath, path.resolve('/tmp/some-vault'));
  assert.deepEqual(cfg.allowedUserIds, ['U1', 'U2']);
  assert.equal(cfg.logLevel, 'info');
});

test('loadConfig defaults timezone to host TZ when blank', () => {
  const cfg = loadConfig({ ...BASE, TIMEZONE: '' });
  assert.equal(typeof cfg.timezone, 'string');
  assert.ok(cfg.timezone.length > 0);
});

test('loadConfig honors TIMEZONE override', () => {
  const cfg = loadConfig({ ...BASE, TIMEZONE: 'UTC' });
  assert.equal(cfg.timezone, 'UTC');
});

test('loadConfig fails fast when SLACK_BOT_TOKEN is missing', () => {
  assert.throws(() => loadConfig({ ...BASE, SLACK_BOT_TOKEN: '' }), /SLACK_BOT_TOKEN/);
});

test('loadConfig fails fast when SLACK_APP_TOKEN is missing (Socket Mode required)', () => {
  assert.throws(() => loadConfig({ ...BASE, SLACK_APP_TOKEN: '' }), /SLACK_APP_TOKEN/);
});

test('loadConfig fails fast when VAULT_PATH is missing', () => {
  assert.throws(() => loadConfig({ ...BASE, VAULT_PATH: '' }), /VAULT_PATH/);
});

test('loadConfig accepts empty ALLOWED_SLACK_USER_IDS as no allowlist', () => {
  const cfg = loadConfig(BASE);
  assert.deepEqual(cfg.allowedUserIds, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/brain && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `services/brain/src/config.js`**

```js
const path = require('node:path');

/**
 * Load and validate runtime configuration.
 * Reads from a passed-in environment object (default: process.env) so
 * tests can supply overrides without mutating the real env.
 *
 * Throws on missing required vars rather than running with broken state.
 */
function loadConfig(env = process.env) {
  required(env, 'SLACK_BOT_TOKEN');
  required(env, 'SLACK_APP_TOKEN');
  required(env, 'SLACK_SIGNING_SECRET');
  required(env, 'VAULT_PATH');

  const allowed = (env.ALLOWED_SLACK_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const tz = (env.TIMEZONE || '').trim() || hostTimezone();

  return {
    slack: {
      botToken: env.SLACK_BOT_TOKEN,
      appToken: env.SLACK_APP_TOKEN,
      signingSecret: env.SLACK_SIGNING_SECRET,
    },
    vaultPath: path.resolve(env.VAULT_PATH),
    allowedUserIds: allowed,
    timezone: tz,
    logLevel: env.LOG_LEVEL || 'info',
  };
}

function required(env, key) {
  if (!env[key] || env[key].trim() === '') {
    throw new Error(`config: ${key} is required`);
  }
}

function hostTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

module.exports = { loadConfig };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/brain && npm test`
Expected: All config tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/config.js services/brain/test/config.test.js
git commit -m "brain: add env loader with fail-fast validation"
```

---

### Task 7: `slack/adapter.js` and `slack/reply.js` — Socket Mode + capture wiring

**Files:**
- Create: `services/brain/src/slack/reply.js`
- Create: `services/brain/src/slack/adapter.js`
- Create: `services/brain/test/slack-adapter.test.js`

We test the *handler logic* in isolation (the function the adapter installs as the
event listener) without booting real Bolt or hitting Slack — Bolt itself we trust.

- [ ] **Step 1: Implement `services/brain/src/slack/reply.js`**

```js
/**
 * Post a threaded reply, swallowing errors so a Slack outage doesn't take
 * the capture path with it. Returns true on success, false on failure.
 */
async function ack(client, { channel, threadTs, text }) {
  try {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text,
    });
    return true;
  } catch (err) {
    console.error('[slack/reply] ack failed:', err.message);
    return false;
  }
}

module.exports = { ack };
```

- [ ] **Step 2: Write the failing tests for the capture handler**

Create `services/brain/test/slack-adapter.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { buildHandlers } = require('../src/slack/adapter');

async function tmpVault() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-slack-'));
}

test('DM handler writes capture for allowed user', async () => {
  const vault = await tmpVault();
  const { onMessage } = buildHandlers({ vaultPath: vault, allowedUserIds: ['U1'] });
  const calls = [];
  await onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      user: 'U1',
      text: 'hello brain',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async (a) => { calls.push(a); } } },
    logger: { warn: () => {}, error: () => {} },
  });
  const inbox = path.join(vault, '00_Inbox');
  const files = await fs.readdir(inbox);
  assert.equal(files.length, 1);
  await fs.rm(vault, { recursive: true, force: true });
});

test('DM handler ignores disallowed user', async () => {
  const vault = await tmpVault();
  const { onMessage } = buildHandlers({ vaultPath: vault, allowedUserIds: ['U1'] });
  await onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      user: 'U_BAD',
      text: 'hi',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async () => {} } },
    logger: { warn: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  await fs.rm(vault, { recursive: true, force: true });
});

test('DM handler ignores bot messages', async () => {
  const vault = await tmpVault();
  const { onMessage } = buildHandlers({ vaultPath: vault, allowedUserIds: [] });
  await onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      bot_id: 'B1',
      text: 'pong',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async () => {} } },
    logger: { warn: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  await fs.rm(vault, { recursive: true, force: true });
});

test('app_mention handler strips leading mention and writes capture', async () => {
  const vault = await tmpVault();
  const { onAppMention } = buildHandlers({ vaultPath: vault, allowedUserIds: [] });
  await onAppMention({
    event: {
      channel: 'C1',
      user: 'U1',
      text: '<@UBOT> idea: pose detection',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async () => {} } },
    logger: { warn: () => {}, error: () => {} },
  });
  const files = await fs.readdir(path.join(vault, '00_Inbox'));
  assert.equal(files.length, 1);
  const contents = await fs.readFile(path.join(vault, '00_Inbox', files[0]), 'utf8');
  assert.match(contents, /idea: pose detection/);
  assert.doesNotMatch(contents, /<@UBOT>/);
  await fs.rm(vault, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd services/brain && npm test`
Expected: FAIL — module `../src/slack/adapter` not found.

- [ ] **Step 4: Implement `services/brain/src/slack/adapter.js`**

```js
const { App } = require('@slack/bolt');
const { writeCapture } = require('../capture/writeInbox');
const { ack } = require('./reply');

/**
 * Build the per-event handler functions in isolation so they can be unit-tested
 * without booting a real Bolt app.
 */
function buildHandlers({ vaultPath, allowedUserIds }) {
  const isAllowed = (userId) => {
    if (!userId) return false;
    if (allowedUserIds.length === 0) return true;
    return allowedUserIds.includes(userId);
  };

  async function onMessage({ message, client, logger }) {
    try {
      if (message.subtype || message.bot_id) return;
      if (!message.user) return;
      if (!isAllowed(message.user)) {
        logger.warn(`ignoring message from ${message.user}`);
        return;
      }
      // Slice 1: only DM (im); ignore other channel types here.
      if (message.channel_type !== 'im' && !(message.channel || '').startsWith('D')) {
        return;
      }
      const text = (message.text || '').trim();
      if (!text) return;

      const filePath = await writeCapture({
        vaultPath,
        text,
        userId: message.user,
        ts: message.ts,
        channelType: 'dm',
        channelId: message.channel,
      });
      logger.info?.(`capture written: ${filePath}`);
      // Slice 1 sends no ack (per design: ack copy lands in Slice 2 with the
      // tag pass). Hook is here for future use.
      void ack; void client;
    } catch (err) {
      logger.error(err);
    }
  }

  async function onAppMention({ event, client, logger }) {
    try {
      if (!isAllowed(event.user)) return;
      const text = stripLeadingMentions(event.text);
      if (!text) return;
      const filePath = await writeCapture({
        vaultPath,
        text,
        userId: event.user,
        ts: event.ts,
        channelType: 'channel',
        channelId: event.channel,
      });
      logger.info?.(`capture written (mention): ${filePath}`);
      void ack; void client;
    } catch (err) {
      logger.error(err);
    }
  }

  return { onMessage, onAppMention };
}

function stripLeadingMentions(text) {
  return (text || '').replace(/<@[^>]+>\s*/g, '').trim();
}

/**
 * Boot a real Bolt app in Socket Mode, registering the handlers above.
 * Returns the App instance so the caller can `await app.start()`.
 */
function buildApp({ config }) {
  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
  });

  const { onMessage, onAppMention } = buildHandlers({
    vaultPath: config.vaultPath,
    allowedUserIds: config.allowedUserIds,
  });

  app.message(async (args) => onMessage(args));
  app.event('app_mention', async (args) => onAppMention(args));

  return app;
}

module.exports = { buildApp, buildHandlers, stripLeadingMentions };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/brain && npm test`
Expected: All slack adapter tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/brain/src/slack/ services/brain/test/slack-adapter.test.js
git commit -m "brain: slack adapter (socket mode) with capture handlers"
```

---

### Task 8: `src/index.js` — bootstrap

**Files:**
- Create: `services/brain/src/index.js`

This is glue; no tests (covered by manual smoke later in Task 11).

- [ ] **Step 1: Implement `services/brain/src/index.js`**

```js
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });

const { loadConfig } = require('./config');
const { buildApp } = require('./slack/adapter');

async function main() {
  const config = loadConfig(process.env);
  const app = buildApp({ config });
  await app.start();
  console.log(`[brain] started in Socket Mode`);
  console.log(`[brain] vault: ${config.vaultPath}`);
  console.log(`[brain] allowlist: ${config.allowedUserIds.join(',') || '(open)'}`);
}

main().catch((err) => {
  console.error('[brain] fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Sanity-check syntax**

Run: `cd services/brain && npm run check`
Expected: No output (success).

- [ ] **Step 3: Commit**

```bash
git add services/brain/src/index.js
git commit -m "brain: bootstrap entrypoint"
```

---

### Task 9: `cli/doctor.js` — health check (TDD)

**Files:**
- Create: `services/brain/test/doctor.test.js`
- Create: `services/brain/src/cli/doctor.js`

Doctor is structured as `runDoctor({ env, fetchSlackAuth })` returning a list of
`{ name, ok, message }` so it's testable without real network calls.

- [ ] **Step 1: Write the failing tests**

Create `services/brain/test/doctor.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runDoctor } = require('../src/cli/doctor');

async function tmpVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-doc-'));
  await fs.mkdir(path.join(dir, '00_Inbox'), { recursive: true });
  return dir;
}

test('doctor PASSes with valid env and reachable Slack', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true, user: 'brain', team: 'T1' }),
  });
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks, null, 2));
  await fs.rm(vault, { recursive: true, force: true });
});

test('doctor FAILs when SLACK_APP_TOKEN missing', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: '',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true }),
  });
  const env_check = checks.find((c) => c.name === 'env');
  assert.equal(env_check.ok, false);
  assert.match(env_check.message, /SLACK_APP_TOKEN/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('doctor FAILs when vault is not writable', async () => {
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: '/no/such/path/vault',
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true }),
  });
  const vault_check = checks.find((c) => c.name === 'vault');
  assert.equal(vault_check.ok, false);
});

test('doctor FAILs when Slack auth call returns ok=false', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: false, error: 'invalid_auth' }),
  });
  const slack_check = checks.find((c) => c.name === 'slack');
  assert.equal(slack_check.ok, false);
  assert.match(slack_check.message, /invalid_auth/);
  await fs.rm(vault, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/brain && npm test`
Expected: FAIL — module `../src/cli/doctor` not found.

- [ ] **Step 3: Implement `services/brain/src/cli/doctor.js`**

```js
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const fs = require('node:fs/promises');
const path = require('node:path');
const { WebClient } = require('@slack/web-api');

/**
 * Run all doctor checks. Pure with respect to passed-in env + fetchSlackAuth.
 * Returns an array of { name, ok, message }.
 */
async function runDoctor({ env, fetchSlackAuth }) {
  const checks = [];

  // env
  const required = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET', 'VAULT_PATH'];
  const missing = required.filter((k) => !env[k] || env[k].trim() === '');
  checks.push({
    name: 'env',
    ok: missing.length === 0,
    message: missing.length === 0 ? 'all required vars present' : `missing: ${missing.join(', ')}`,
  });

  // vault
  const vaultPath = env.VAULT_PATH || '';
  let vaultOk = false;
  let vaultMsg = '';
  try {
    const stat = await fs.stat(vaultPath);
    if (!stat.isDirectory()) {
      vaultMsg = 'VAULT_PATH is not a directory';
    } else {
      const probe = path.join(vaultPath, `.brain-write-probe-${process.pid}`);
      await fs.writeFile(probe, 'x', 'utf8');
      await fs.unlink(probe);
      vaultOk = true;
      vaultMsg = `${vaultPath} is readable + writable`;
    }
  } catch (err) {
    vaultMsg = `vault unreachable: ${err.message}`;
  }
  checks.push({ name: 'vault', ok: vaultOk, message: vaultMsg });

  // 00_Inbox exists
  let inboxOk = false;
  let inboxMsg = '';
  if (vaultOk) {
    try {
      const stat = await fs.stat(path.join(vaultPath, '00_Inbox'));
      inboxOk = stat.isDirectory();
      inboxMsg = inboxOk ? '00_Inbox/ present' : '00_Inbox/ exists but is not a directory';
    } catch {
      inboxMsg = '00_Inbox/ missing (will be created on first capture)';
      inboxOk = true; // not fatal
    }
  } else {
    inboxMsg = 'skipped (vault check failed)';
  }
  checks.push({ name: 'inbox', ok: inboxOk, message: inboxMsg });

  // slack
  let slackOk = false;
  let slackMsg = '';
  if (missing.includes('SLACK_BOT_TOKEN')) {
    slackMsg = 'skipped (no token)';
  } else {
    try {
      const auth = await fetchSlackAuth(env.SLACK_BOT_TOKEN);
      if (auth.ok) {
        slackOk = true;
        slackMsg = `auth ok: user=${auth.user || '?'} team=${auth.team || '?'}`;
      } else {
        slackMsg = `auth failed: ${auth.error || 'unknown'}`;
      }
    } catch (err) {
      slackMsg = `auth call threw: ${err.message}`;
    }
  }
  checks.push({ name: 'slack', ok: slackOk, message: slackMsg });

  return checks;
}

async function realFetchSlackAuth(token) {
  const client = new WebClient(token);
  return client.auth.test();
}

async function cli() {
  const checks = await runDoctor({ env: process.env, fetchSlackAuth: realFetchSlackAuth });
  let allOk = true;
  for (const c of checks) {
    const tag = c.ok ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${c.name.padEnd(8)} ${c.message}`);
    if (!c.ok) allOk = false;
  }
  process.exit(allOk ? 0 : 1);
}

if (require.main === module) {
  cli();
}

module.exports = { runDoctor };
```

- [ ] **Step 4: Add `@slack/web-api` to dependencies**

Modify `services/brain/package.json` — append `"@slack/web-api": "^7.0.0"` to
`dependencies` (alphabetically after `@slack/bolt`):

```json
  "dependencies": {
    "@slack/bolt": "^3.22.0",
    "@slack/web-api": "^7.0.0",
    "dotenv": "^16.4.5",
    "js-yaml": "^4.1.0"
  }
```

Then run `cd services/brain && npm install`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/brain && npm test`
Expected: All doctor tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/brain/src/cli/doctor.js services/brain/test/doctor.test.js services/brain/package.json services/brain/package-lock.json
git commit -m "brain: add doctor health-check command"
```

---

### Task 10: LaunchAgent install/uninstall scripts

**Files:**
- Create: `scripts/install-launchd.sh`
- Create: `scripts/uninstall-launchd.sh`

These are macOS-specific. Tested by running them on the user's machine in Task 11.

- [ ] **Step 1: Implement `scripts/install-launchd.sh`**

```bash
#!/usr/bin/env bash
# Install the brain service as a per-user LaunchAgent.
set -euo pipefail

LABEL="com.secondbrain.brain"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/secondbrain"

if [[ -z "$NODE_BIN" ]]; then
  echo "[install-launchd] node not found in PATH. Install Node 18+ first." >&2
  exit 1
fi

mkdir -p "$PLIST_DIR" "$LOG_DIR"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${NODE_BIN}</string>
      <string>${ROOT}/services/brain/src/index.js</string>
    </array>
    <key>WorkingDirectory</key><string>${ROOT}/services/brain</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ProcessType</key><string>Interactive</string>
    <key>StandardOutPath</key><string>${LOG_DIR}/brain.log</string>
    <key>StandardErrorPath</key><string>${LOG_DIR}/brain.err</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
  </dict>
</plist>
EOF

# Reload (unload first if previously loaded; ignore errors)
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "[install-launchd] installed: $PLIST"
echo "[install-launchd] logs:      $LOG_DIR/brain.{log,err}"
echo "[install-launchd] status:    launchctl list | grep ${LABEL}"
```

- [ ] **Step 2: Implement `scripts/uninstall-launchd.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

LABEL="com.secondbrain.brain"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "[uninstall-launchd] removed: $PLIST"
else
  echo "[uninstall-launchd] not installed: $PLIST"
fi
```

- [ ] **Step 3: Make the scripts executable**

Run:
```bash
chmod +x scripts/install-launchd.sh scripts/uninstall-launchd.sh
```

- [ ] **Step 4: Add `lint:plist` lint pass to catch malformed plist before install**

Modify `services/brain/package.json` — add a script entry:

```json
"scripts": {
  "start": "node src/index.js",
  "test": "node --test test/",
  "doctor": "node src/cli/doctor.js",
  "check": "node --check src/index.js",
  "lint:plist": "plutil -lint $HOME/Library/LaunchAgents/com.secondbrain.brain.plist"
}
```

(`plutil` ships with macOS; this is a no-op on other platforms but the script
itself is macOS-only.)

- [ ] **Step 5: Commit**

```bash
git add scripts/install-launchd.sh scripts/uninstall-launchd.sh services/brain/package.json
git commit -m "brain: add macOS LaunchAgent install/uninstall scripts"
```

---

### Task 11: Update root scripts and retire `slack-ingest`

**Files:**
- Modify: `package.json`
- Modify: `scripts/dev.sh`
- Modify: `README.md`
- Delete: `services/slack-ingest/` (entire directory)

`slack-ingest` is functionally subsumed by `services/brain/` (Slice 1 keeps the
same on-disk contract). Removing it prevents drift.

- [ ] **Step 1: Update root `package.json`**

```json
{
  "name": "second-brain",
  "private": true,
  "description": "PARA vault + conversational brain",
  "scripts": {
    "dev": "bash scripts/dev.sh",
    "brain:start": "cd services/brain && npm start",
    "brain:doctor": "cd services/brain && npm run doctor",
    "brain:test": "cd services/brain && npm test",
    "brain:install": "cd services/brain && npm install",
    "launchd:install": "bash scripts/install-launchd.sh",
    "launchd:uninstall": "bash scripts/uninstall-launchd.sh"
  }
}
```

- [ ] **Step 2: Replace `scripts/dev.sh` with a brain-aware version**

Rewrite `scripts/dev.sh`:

```bash
#!/usr/bin/env bash
# One-command dev: prepare vault, install deps, run brain (Socket Mode).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export VAULT_PATH="${VAULT_PATH:-$ROOT/vault}"
BRAIN_DIR="$ROOT/services/brain"

cd "$ROOT"

echo "[dev] Repo: $ROOT"

# Vault
if [[ ! -d "$ROOT/vault" ]]; then
  echo "[dev] Creating vault from vault.example -> $ROOT/vault"
  cp -R "$ROOT/vault.example" "$ROOT/vault"
fi

# Brain .env
if [[ ! -f "$BRAIN_DIR/.env" ]]; then
  echo "[dev] Creating $BRAIN_DIR/.env from .env.example"
  cp "$BRAIN_DIR/.env.example" "$BRAIN_DIR/.env"
  echo ""
  echo "Edit $BRAIN_DIR/.env, fill in:"
  echo "  SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET, VAULT_PATH"
  echo "Then run: npm run dev"
  exit 1
fi

# Deps
if [[ ! -d "$BRAIN_DIR/node_modules" ]]; then
  echo "[dev] Installing brain dependencies..."
  (cd "$BRAIN_DIR" && npm install)
fi

# Doctor before starting
(cd "$BRAIN_DIR" && npm run doctor) || {
  echo "[dev] doctor reported failures; fix the above before running brain"
  exit 1
}

echo "[dev] Starting brain (Socket Mode; no public URL needed)..."
exec node "$BRAIN_DIR/src/index.js"
```

- [ ] **Step 3: Update root `README.md`**

Replace the body of the root `README.md` with:

```markdown
# Second Brain

Local-first PARA vault + conversational brain over Slack and Google Calendar.

- **Vault** lives at `vault/` (gitignored). Open in Obsidian.
- **`vault.example/`** is the public skeleton checked into git.
- **`services/brain/`** is the Node service that captures Slack messages into
  `vault/00_Inbox/` and (in later slices) classifies, answers, and routes
  notes via Anthropic Claude.

## Quick start

\`\`\`bash
npm run dev
\`\`\`

On first run it creates `vault/` from `vault.example/` and
`services/brain/.env` from `.env.example`. Edit the `.env`, then run again.

The brain runs in Slack **Socket Mode** — no public URL or ngrok required.
See `services/brain/README.md` for Slack setup.

## Run as a background service (macOS)

\`\`\`bash
npm run launchd:install      # starts on login, restarts on crash
npm run launchd:uninstall    # remove
\`\`\`

Logs: `~/Library/Logs/secondbrain/brain.{log,err}`.

## Health check

\`\`\`bash
npm run brain:doctor
\`\`\`

## Design

- Spec:   `docs/superpowers/specs/2026-04-28-conversational-brain-design.md`
- Slice 1 plan: `docs/superpowers/plans/2026-04-28-brain-slice-1-foundation.md`
\`\`\`
```

- [ ] **Step 4: Delete the old slack-ingest service**

Run:
```bash
git rm -r services/slack-ingest
```

(If the directory has not yet been added to git, just remove with `rm -rf services/slack-ingest`.)

- [ ] **Step 5: Sanity smoke**

Run:
```bash
cd services/brain
npm install
npm test
npm run check
```

Expected: install succeeds; all tests pass; `npm run check` is silent.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/dev.sh README.md
# (services/slack-ingest deletion already staged by `git rm` above)
git commit -m "brain: route root scripts through brain; retire slack-ingest"
```

---

### Task 12: Manual end-to-end smoke

This task is **not run by an automated worker** — it requires a real Slack
workspace and a real Mac. The plan execution should pause here and present
the checklist to the human.

**Files:** none changed.

- [ ] **Step 1: Configure Slack app**

Per `services/brain/README.md`:

1. Create app at https://api.slack.com/apps (or reuse existing one).
2. Enable **Socket Mode** + generate app-level token (`xapp-...`) with `connections:write`.
3. Bot scopes: `app_mentions:read`, `im:history`, `chat:write`.
4. Subscribe to bot events: `app_mention`, `message.im`.
5. Install/reinstall to workspace; copy bot token (`xoxb-...`) and signing secret.
6. Fill `services/brain/.env` with the three Slack values + `VAULT_PATH`.

- [ ] **Step 2: Install deps and run doctor**

```bash
cd services/brain
npm install
npm run doctor
```

Expected: 4 checks, all `[PASS]`. If any FAIL, fix before continuing.

- [ ] **Step 3: Start the service in foreground**

```bash
npm start
```

Expected output:
```
[brain] started in Socket Mode
[brain] vault: /Users/.../vault
[brain] allowlist: U... (open)
```

- [ ] **Step 4: DM the bot from Slack**

Send a DM with text "test capture from slice 1".

Verify on disk:
```bash
ls -lt vault/00_Inbox/ | head -3
```

Expected: a new file like `2026-04-29 HHmmss - slack.md` containing the message
text and frontmatter (`source: slack`, `status: inbox`, `slack_user: U...`).

- [ ] **Step 5: @-mention the bot in a public channel**

In a channel the bot is in, post `@brain mention test`.

Verify a second file appears in `00_Inbox/` with `channel_type: channel`.

- [ ] **Step 6: Stop the service, install LaunchAgent**

`Ctrl-C` to stop, then:

```bash
cd ../..
npm run launchd:install
launchctl list | grep com.secondbrain.brain
```

Expected: PID listed (non-zero), exit status `0`.

- [ ] **Step 7: DM the bot again to confirm LaunchAgent serves**

Send a DM "post-launchd test"; verify a file appears in `00_Inbox/` with no
manual `npm start`. Tail the log if anything's off:

```bash
tail -f ~/Library/Logs/secondbrain/brain.log
```

- [ ] **Step 8: Commit any tweaks made during smoke**

If you adjusted `.env.example` comments, README, or scripts based on what you
learned: commit with message `docs(brain): smoke-test fixups`.

---

## Self-review (filled in by plan author)

**Spec coverage:**
- Module layout for capture path → Tasks 1, 5, 7, 8 ✓
- `util/paths.js` invariant → Task 2 ✓
- `util/frontmatter.js` invariant → Task 3 ✓
- Atomic writes + no-overwrite default → Task 4 ✓
- Socket Mode transport → Tasks 7, 8 ✓
- Existing capture parity → Tasks 5, 7 ✓
- LaunchAgent + KeepAlive + log paths → Task 10 ✓
- `brain:doctor` (env / vault / Slack auth checks) → Task 9 ✓
- `last_run.json` freshness check is **deferred to Slice 6**; no batch in Slice 1, so no last-run state to check yet ✓ (noted)
- Slack ack one-liner → **deferred to Slice 2** (the tag pass writes the ack copy) ✓
- All non-foundation features (classifier, chat, status, calendar, batch) → not in this slice ✓

**Placeholder scan:** none.

**Type/name consistency:**
- `safeJoin(vaultPath, relPath)` used consistently in Tasks 2, 4.
- `parse / merge / serialize` from `util/frontmatter` used consistently in Tasks 3, 4.
- `writeNote({ vaultPath, relPath, frontmatter, body, overwrite? })` consistent in Tasks 4, 5.
- `writeCapture({ vaultPath, text, userId, ts, channelType, channelId })` consistent in Tasks 5, 7.
- `loadConfig(env)` shape (slack/{botToken,appToken,signingSecret}, vaultPath, allowedUserIds, timezone, logLevel) consistent in Tasks 6, 7, 8.
- `runDoctor({ env, fetchSlackAuth })` consistent in Task 9.
- `buildHandlers({ vaultPath, allowedUserIds })` returns `{ onMessage, onAppMention }` consistent in Task 7.

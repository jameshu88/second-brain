# Conversational Brain — Slice 2.5 (Chat + Calendar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the brain from capture-only to a real conversational agent. Slack messages are now classified as `capture | question | both` by Haiku. Question messages run through a Sonnet 4.6 tool loop with `search_vault`, `read_note`, `list_events`, and `create_event`. Google Calendar is wired up via a one-time OAuth setup. Calendar writes go through a propose → `y` confirm gate keyed by Slack thread timestamp.

**Architecture:** Same modular monolith. New `agent/chat.js` owns the tool loop. New `tools/` for vault search/read and calendar read/create. New `google/auth.js` + `cli/google-auth.js` handle one-time OAuth and refresh. New `state/threads.js` persists pending confirm actions. The Slack adapter grows a pre-classifier hook that intercepts `y`/`yes` replies and fires queued actions.

**Tech Stack:** Node 18+, `@anthropic-ai/sdk` (already), `googleapis`, ripgrep (system binary).

**Source spec:** `docs/superpowers/specs/2026-04-28-conversational-brain-design.md` — sections "Question path (chat)" and "Calendar integration".

**Out of scope for this slice:** Status synthesis (`synthesize_status` tool — Slice 3), daily batch (Slice 4), MCP migration (post-1.0). Recurring calendar events.

**Decisions baked in:**

- Google creds are **optional**; brain starts without them. Calendar tools politely refuse if not configured.
- Default calendar = `primary`; multi-calendar via `DEFAULT_CALENDAR_IDS=primary,work@example.com`.
- Search ranking = file `mtime` desc.
- Thread memory window = last 20 messages from `conversations.replies`.
- Tool-loop max turns = 10 (prevents runaway agents).
- Pending confirm action expires after 10 minutes.
- Classifier failure falls back to `capture` (safer than dropping the message).

---

### Task 1: Optional Google config + `googleapis` dep

**Files:**
- Modify: `services/brain/package.json` (add `googleapis`)
- Modify: `services/brain/.env.example` (Google block + DEFAULT_CALENDAR_IDS)
- Modify: `services/brain/src/config.js` (expose `google.*` and `defaultCalendarIds`; all optional)
- Modify: `services/brain/test/config.test.js` (3 new tests)

- [ ] **Step 1: Add dep**

In `services/brain/package.json`, add `"googleapis": "^144.0.0"` to dependencies (alphabetical, after `dotenv`):

```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.32.0",
  "@slack/bolt": "^3.22.0",
  "@slack/web-api": "^7.0.0",
  "dotenv": "^16.4.5",
  "googleapis": "^144.0.0",
  "js-yaml": "^4.1.0"
}
```

Run `cd services/brain && npm install`.

- [ ] **Step 2: Append Google block to `.env.example`**

Read the existing `.env.example`. After the `--- LLM ---` block, before `--- Access control ---`, insert:

```
# --- Google Calendar (optional) ---
# If set, the brain can read/create calendar events from chat. If unset, calendar
# tools politely return "not configured" and the brain otherwise works fine.
# Get OAuth client at https://console.cloud.google.com/apis/credentials
# (create OAuth client of type "Desktop app").
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=

# Comma-separated calendar IDs to scan by default; usually leave as 'primary'.
DEFAULT_CALENDAR_IDS=primary
```

- [ ] **Step 3: Update `services/brain/test/config.test.js`**

Append three new tests at the end:

```js
test('loadConfig exposes google block when creds are set', () => {
  const cfg = loadConfig({
    ...BASE,
    GOOGLE_OAUTH_CLIENT_ID: 'cid.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'gsec',
  });
  assert.equal(cfg.google.clientId, 'cid.apps.googleusercontent.com');
  assert.equal(cfg.google.clientSecret, 'gsec');
});

test('loadConfig sets google block to null when creds are missing', () => {
  const cfg = loadConfig(BASE);
  assert.equal(cfg.google, null);
});

test('loadConfig parses DEFAULT_CALENDAR_IDS into array', () => {
  const cfg = loadConfig({ ...BASE, DEFAULT_CALENDAR_IDS: 'primary, work@example.com' });
  assert.deepEqual(cfg.defaultCalendarIds, ['primary', 'work@example.com']);
});
```

- [ ] **Step 4: Run tests, expect FAIL**

Run: `cd services/brain && npm test`

- [ ] **Step 5: Update `services/brain/src/config.js`**

Replace contents:

```js
const path = require('node:path');

function loadConfig(env = process.env) {
  required(env, 'SLACK_BOT_TOKEN');
  required(env, 'SLACK_APP_TOKEN');
  required(env, 'SLACK_SIGNING_SECRET');
  required(env, 'VAULT_PATH');
  required(env, 'ANTHROPIC_API_KEY');

  const allowed = (env.ALLOWED_SLACK_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const tz = (env.TIMEZONE || '').trim() || hostTimezone();

  const calIds = (env.DEFAULT_CALENDAR_IDS || 'primary')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const google =
    env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
      ? { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET }
      : null;

  return {
    slack: {
      botToken: env.SLACK_BOT_TOKEN,
      appToken: env.SLACK_APP_TOKEN,
      signingSecret: env.SLACK_SIGNING_SECRET,
    },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
      tagModel: env.ANTHROPIC_TAG_MODEL || 'claude-haiku-4-5-20251001',
      chatModel: env.ANTHROPIC_CHAT_MODEL || 'claude-sonnet-4-6',
      classifyModel: env.ANTHROPIC_CLASSIFY_MODEL || 'claude-haiku-4-5-20251001',
    },
    google,
    defaultCalendarIds: calIds,
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

- [ ] **Step 6: Run tests, expect 68/68 pass (65 + 3)**

- [ ] **Step 7: Commit**

```bash
git add services/brain/package.json services/brain/package-lock.json \
        services/brain/.env.example services/brain/src/config.js \
        services/brain/test/config.test.js
git commit -m "brain: add optional google config + classifyModel default"
```

---

### Task 2: `state/threads.js` — pending action store (TDD)

**Files:**
- Create: `services/brain/test/state-threads.test.js`
- Create: `services/brain/src/state/threads.js`

Persists pending confirm actions to `services/brain/.state/threads.json` keyed by Slack `thread_ts`. 10-minute expiry.

- [ ] **Step 1: Tests**

Create `services/brain/test/state-threads.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { setPending, getPending, clearPending, _setPathOverride } = require('../src/state/threads');

async function tmpStateDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-state-'));
}

test('setPending then getPending round-trips an action', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  await setPending('1746000000.000000', { kind: 'create_event', args: { title: 'Pitch prep' } });
  const got = await getPending('1746000000.000000');
  assert.equal(got.kind, 'create_event');
  assert.equal(got.args.title, 'Pitch prep');
  await fs.rm(dir, { recursive: true, force: true });
});

test('getPending returns null for unknown thread', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  const got = await getPending('does-not-exist');
  assert.equal(got, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('getPending returns null after expiry', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  await setPending('t1', { kind: 'create_event', args: {} }, { ttlMs: 10 });
  await new Promise((r) => setTimeout(r, 25));
  const got = await getPending('t1');
  assert.equal(got, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('clearPending removes a stored action', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  await setPending('t1', { kind: 'x', args: {} });
  await clearPending('t1');
  const got = await getPending('t1');
  assert.equal(got, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('store survives multiple actions for different threads', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  await setPending('t1', { kind: 'a', args: { x: 1 } });
  await setPending('t2', { kind: 'b', args: { x: 2 } });
  const a = await getPending('t1');
  const b = await getPending('t2');
  assert.equal(a.kind, 'a');
  assert.equal(b.kind, 'b');
  await fs.rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implementation**

Create `services/brain/src/state/threads.js`:

```js
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
```

- [ ] **Step 4: Run tests, expect 73/73 pass (68 + 5)**

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/state/threads.js services/brain/test/state-threads.test.js
git commit -m "brain: add pending-action store for write-confirm flow"
```

---

### Task 3: Real classifier (TDD)

**Files:**
- Create: `services/brain/src/agent/prompts/classify.md`
- Modify: `services/brain/src/agent/classify.js` (replace stub with real Haiku call)
- Modify: `services/brain/test/agent-classify.test.js`

Classifier returns `'capture' | 'question' | 'both'` via tool-use. On any error, falls back to `'capture'`.

- [ ] **Step 1: System prompt**

Create `services/brain/src/agent/prompts/classify.md`:

```
You classify a Slack message from the user as one of:

- "capture": The user is dropping an idea, task, fragment, or note for later. Examples: "rep counter via pose estimation", "remember to email Acme tomorrow", "interesting paper on diffusion models".
- "question": The user is asking the agent something or telling it to do something it can act on. Examples: "what's on my calendar tomorrow?", "find my notes on SAFEs", "block 2 hours Thursday for FormLab".
- "both": The user is dropping a thought AND asking for action on it. Example: "idea: rep counter via pose estimation — does this overlap with the FormLab MOC?".

Output is delivered exclusively via the `classify` tool. Always call it.

Be conservative on "both" — only use it when the message clearly contains both a fragment to remember AND a question/command. When in doubt, prefer "capture".
```

- [ ] **Step 2: Update tests**

Replace `services/brain/test/agent-classify.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMessage } = require('../src/agent/classify');

function fakeClient(verdict) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'tool_use', name: 'classify', input: { verdict } }],
      }),
    },
  };
}

test('classifyMessage returns "capture" when model says capture', async () => {
  const out = await classifyMessage({ client: fakeClient('capture'), model: 'm', text: 'rep counter idea' });
  assert.equal(out, 'capture');
});

test('classifyMessage returns "question" when model says question', async () => {
  const out = await classifyMessage({ client: fakeClient('question'), model: 'm', text: "what's on my calendar?" });
  assert.equal(out, 'question');
});

test('classifyMessage returns "both" when model says both', async () => {
  const out = await classifyMessage({ client: fakeClient('both'), model: 'm', text: 'idea: X — does this match Y?' });
  assert.equal(out, 'both');
});

test('classifyMessage falls back to "capture" on upstream error', async () => {
  const client = { messages: { create: async () => { throw new Error('boom'); } } };
  const out = await classifyMessage({ client, model: 'm', text: 'hi' });
  assert.equal(out, 'capture');
});

test('classifyMessage falls back to "capture" on invalid verdict', async () => {
  const out = await classifyMessage({ client: fakeClient('garbage'), model: 'm', text: 'hi' });
  assert.equal(out, 'capture');
});

test('classifyMessage rejects empty text', async () => {
  await assert.rejects(classifyMessage({ client: fakeClient('capture'), model: 'm', text: '' }), /text/i);
});
```

- [ ] **Step 3: Run, expect FAIL**

- [ ] **Step 4: Replace `services/brain/src/agent/classify.js`**

```js
const fs = require('node:fs');
const path = require('node:path');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts/classify.md'), 'utf8');
const VALID = new Set(['capture', 'question', 'both']);

const TOOL = {
  name: 'classify',
  description: 'Save the classification of the user message.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['capture', 'question', 'both'] },
    },
    required: ['verdict'],
  },
};

async function classifyMessage({ client, model, text }) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('classifyMessage: text is required');
  }
  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 64,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'classify' },
      messages: [{ role: 'user', content: text }],
    });
    const block = (resp.content || []).find((b) => b.type === 'tool_use' && b.name === 'classify');
    const v = block?.input?.verdict;
    if (VALID.has(v)) return v;
    return 'capture';
  } catch {
    return 'capture';
  }
}

module.exports = { classifyMessage, TOOL, SYSTEM_PROMPT };
```

- [ ] **Step 5: Update test/slack-adapter.test.js**

The existing slack-adapter tests construct `buildHandlers` with stub deps that no longer match the signature (the adapter will need access to `anthropic.client` for both classify AND tag). Open the file. The existing `makeBuilder` already passes `anthropic: { client, model }`. **No change needed for adapter tests in this task** — they still work because `classifyMessage` falls back to `'capture'` when given a fake client that doesn't return a `classify` tool block (and since the existing fake returns `save_tags`, classify will fail and fall back to capture, preserving prior test behavior).

Confirm by running `npm test` and reading the output. All slack-adapter tests should still pass.

- [ ] **Step 6: Run tests, expect 78/78 pass (73 + 6 - 3 old classify) — 73 + 6 - 3 = 76**

Recount: prior was 73 from Task 2. Old classify tests (3) are removed; new classify tests (6) are added: 73 - 3 + 6 = 76.

Run: `cd services/brain && npm test`. Expected: 76 pass.

- [ ] **Step 7: Commit**

```bash
git add services/brain/src/agent/classify.js \
        services/brain/src/agent/prompts/classify.md \
        services/brain/test/agent-classify.test.js
git commit -m "brain: real classifier via haiku tool-use (capture | question | both)"
```

---

### Task 4: Chat system prompt

**Files:**
- Create: `services/brain/src/agent/prompts/chat.md`

No tests; documentation/prompt content.

- [ ] **Step 1: Create the prompt**

Create `services/brain/src/agent/prompts/chat.md`:

```
You are a personal-knowledge agent for the user's PARA Obsidian vault and Google Calendar. The user talks to you over Slack.

Style:
- Tight, direct replies. The user reads on a phone.
- No preamble like "Sure, I'd be happy to..." — answer the question.
- Format with short bullets only when listing items.
- Wrap any wikilinks as `[[Path/To/Note]]` so the user can click them in Obsidian.

Tools you have:
- `search_vault` — substring search over markdown files in the vault. Returns `[{ path, line, snippet, frontmatter, mtime }]` sorted recent-first.
- `read_note` — full file by vault-relative path. Use this to expand on a search hit.
- `list_events` — Google Calendar read. Args: `from`, `to` (ISO 8601 strings), optional `q` (substring), optional `calendar_id`.
- `create_event` — Google Calendar write. **Always proposes; the user must reply `y` for it to actually fire.** When you call this tool, frame your final reply as a proposal, e.g., "Propose: 'FormLab pitch prep' Thu May 1 14:00-16:00 PT. Reply `y` to create."

Rules:
1. **Search before answering from training data.** If the user asks about their own work or notes, call `search_vault` first.
2. **Don't invent paths or events.** If `search_vault` returns nothing, say so. If `list_events` returns no events, say so.
3. **Be conservative with `create_event`.** Always quote the exact title, start, end, and timezone in your final reply so the user knows what they're confirming.
4. **Use `read_note` sparingly** — only when a search hit is interesting enough to expand. The whole file may be long.
5. The user's local timezone is provided in the system context. Interpret natural-language times ("Thursday at 2pm") in that timezone unless the user says otherwise.
6. If a tool returns an error like "Google Calendar not configured", relay that to the user verbatim. Don't pretend the calendar exists.

When in doubt, ask one short clarifying question instead of guessing.
```

- [ ] **Step 2: Run tests for sanity**

Run: `cd services/brain && npm test`. Expected: 76/76 pass (no change — this is doc-only).

- [ ] **Step 3: Commit**

```bash
git add services/brain/src/agent/prompts/chat.md
git commit -m "brain: chat agent system prompt"
```

---

### Task 5: `tools/searchVault.js` — ripgrep wrapper (TDD)

**Files:**
- Create: `services/brain/test/tools-searchVault.test.js`
- Create: `services/brain/src/tools/searchVault.js`

ripgrep returns matches; we parse them into structured hits sorted by file mtime descending. Frontmatter is parsed when present.

- [ ] **Step 1: Tests**

Create `services/brain/test/tools-searchVault.test.js`:

```js
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
  // touch the inbox file mtime to be older
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
  // Both files contain "20" inside their dates; query for it.
  const hits = await searchVault({ vaultPath: vault, query: 'inbox' });
  // Only old.md contains "inbox" status. The hit set should not contain newer file.
  // Sanity: search for shared text.
  const shared = await searchVault({ vaultPath: vault, query: 'status' });
  assert.ok(shared.length >= 2);
  for (let i = 1; i < shared.length; i++) {
    const a = new Date(shared[i - 1].mtime).getTime();
    const b = new Date(shared[i].mtime).getTime();
    assert.ok(a >= b, `expected mtime desc; got ${a} < ${b}`);
  }
  await fs.rm(vault, { recursive: true, force: true });
});

test('searchVault rejects path-traversal in query (no shell injection)', async () => {
  const vault = await buildFixture();
  // ripgrep treats this as a search pattern, not a path. Confirm no crash and no escape.
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
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implementation**

Create `services/brain/src/tools/searchVault.js`:

```js
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parse } = require('../util/frontmatter');

const MAX_HITS = 50;

/**
 * ripgrep-backed search. Returns hits sorted by file mtime desc.
 *
 * @param {object} args
 * @param {string} args.vaultPath
 * @param {string} args.query
 * @returns {Promise<Array<{path,line,snippet,frontmatter,mtime}>>}
 */
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
```

- [ ] **Step 4: Run tests, expect 81/81 pass (76 + 5)**

Note: requires `rg` (ripgrep) to be installed. Most macOS dev machines have it via Homebrew. If not: `brew install ripgrep`.

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/tools/searchVault.js services/brain/test/tools-searchVault.test.js
git commit -m "brain: add ripgrep-backed searchVault tool"
```

---

### Task 6: `tools/readNote.js` (TDD)

**Files:**
- Create: `services/brain/test/tools-readNote.test.js`
- Create: `services/brain/src/tools/readNote.js`

- [ ] **Step 1: Tests**

Create `services/brain/test/tools-readNote.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { readNote } = require('../src/tools/readNote');

async function tmpVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-rd-'));
  await fs.mkdir(path.join(dir, '00_Inbox'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '00_Inbox/n.md'),
    `---\ncreated: 2026-04-01T00:00:00.000Z\nstatus: inbox\n---\nbody text\n`
  );
  return dir;
}

test('readNote returns body and parsed frontmatter', async () => {
  const vault = await tmpVault();
  const out = await readNote({ vaultPath: vault, relPath: '00_Inbox/n.md' });
  assert.equal(out.frontmatter.status, 'inbox');
  assert.match(out.body, /body text/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('readNote rejects path traversal', async () => {
  const vault = await tmpVault();
  await assert.rejects(readNote({ vaultPath: vault, relPath: '../escape.md' }), /outside vault/i);
  await fs.rm(vault, { recursive: true, force: true });
});

test('readNote returns null when file does not exist', async () => {
  const vault = await tmpVault();
  const out = await readNote({ vaultPath: vault, relPath: '00_Inbox/missing.md' });
  assert.equal(out, null);
  await fs.rm(vault, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implementation**

Create `services/brain/src/tools/readNote.js`:

```js
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
```

- [ ] **Step 4: Run tests, expect 84/84 pass (81 + 3)**

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/tools/readNote.js services/brain/test/tools-readNote.test.js
git commit -m "brain: add readNote tool with safeJoin guard"
```

---

### Task 7: `google/auth.js` — token load/refresh (TDD)

**Files:**
- Create: `services/brain/test/google-auth.test.js`
- Create: `services/brain/src/google/auth.js`

Loads OAuth tokens from `~/.config/secondbrain/google-token.json` (or `GOOGLE_TOKEN_PATH` override) and constructs a `google.auth.OAuth2` client. Returns null when not configured.

- [ ] **Step 1: Tests**

Create `services/brain/test/google-auth.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { loadGoogleAuth } = require('../src/google/auth');

async function withTokenFile(content) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-goog-'));
  const tokenPath = path.join(dir, 'token.json');
  await fs.writeFile(tokenPath, JSON.stringify(content), 'utf8');
  return { dir, tokenPath };
}

test('loadGoogleAuth returns null when google config absent', async () => {
  const out = await loadGoogleAuth({ google: null, tokenPath: '/no/such/file' });
  assert.equal(out, null);
});

test('loadGoogleAuth returns null when token file is missing', async () => {
  const out = await loadGoogleAuth({
    google: { clientId: 'cid', clientSecret: 'sec' },
    tokenPath: '/no/such/file.json',
  });
  assert.equal(out, null);
});

test('loadGoogleAuth returns OAuth2 client when token file is valid', async () => {
  const { dir, tokenPath } = await withTokenFile({ refresh_token: 'r', access_token: 'a' });
  const out = await loadGoogleAuth({
    google: { clientId: 'cid', clientSecret: 'sec' },
    tokenPath,
  });
  assert.ok(out);
  assert.equal(typeof out.setCredentials, 'function');
  await fs.rm(dir, { recursive: true, force: true });
});

test('loadGoogleAuth surfaces malformed token file as null', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-goog-'));
  const tokenPath = path.join(dir, 'token.json');
  await fs.writeFile(tokenPath, '{not valid json', 'utf8');
  const out = await loadGoogleAuth({
    google: { clientId: 'cid', clientSecret: 'sec' },
    tokenPath,
  });
  assert.equal(out, null);
  await fs.rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implementation**

Create `services/brain/src/google/auth.js`:

```js
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { google } = require('googleapis');

const DEFAULT_TOKEN_PATH = path.join(os.homedir(), '.config/secondbrain/google-token.json');

async function loadGoogleAuth({ google: googleCfg, tokenPath = DEFAULT_TOKEN_PATH }) {
  if (!googleCfg) return null;

  let token;
  try {
    const raw = await fs.readFile(tokenPath, 'utf8');
    token = JSON.parse(raw);
  } catch {
    return null;
  }

  const client = new google.auth.OAuth2(googleCfg.clientId, googleCfg.clientSecret);
  client.setCredentials(token);
  return client;
}

module.exports = { loadGoogleAuth, DEFAULT_TOKEN_PATH };
```

- [ ] **Step 4: Run tests, expect 88/88 pass (84 + 4)**

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/google/auth.js services/brain/test/google-auth.test.js
git commit -m "brain: add google oauth token loader"
```

---

### Task 8: `cli/google-auth.js` — interactive OAuth setup

**Files:**
- Create: `services/brain/src/cli/google-auth.js`
- Modify: `services/brain/package.json` (add `google-auth` script)
- Modify: root `package.json` (add `brain:google-auth` script)

This is a one-shot interactive script. We don't unit-test it (writing-plans skill says manual flows are fine when interactive). Manual smoke is in Task 16.

- [ ] **Step 1: Implementation**

Create `services/brain/src/cli/google-auth.js`:

```js
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

const TOKEN_PATH = path.join(os.homedir(), '.config/secondbrain/google-token.json');

async function main() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in services/brain/.env');
    console.error('Create credentials at https://console.cloud.google.com/apis/credentials (type: Desktop app)');
    process.exit(1);
  }

  const port = await ephemeralPort();
  const redirectUri = `http://127.0.0.1:${port}`;
  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });

  console.log('\n[google-auth] Open this URL in your browser to authorize the brain:\n');
  console.log(url);
  console.log('\n[google-auth] Listening on', redirectUri, '...\n');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, redirectUri);
      const c = u.searchParams.get('code');
      if (c) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Authorization received. You can close this tab.');
        server.close();
        resolve(c);
      } else {
        res.writeHead(400);
        res.end('No code');
        server.close();
        reject(new Error('No code in redirect'));
      }
    });
    server.listen(port);
    setTimeout(() => { server.close(); reject(new Error('OAuth timeout')); }, 5 * 60 * 1000);
  });

  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    console.error('[google-auth] No refresh_token returned. Revoke prior consent at https://myaccount.google.com/permissions and retry.');
    process.exit(1);
  }

  await fs.mkdir(path.dirname(TOKEN_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), { encoding: 'utf8', mode: 0o600 });
  console.log(`\n[google-auth] Token saved to ${TOKEN_PATH}`);
  console.log('[google-auth] Done. Restart the brain to pick up the new token.');
}

function ephemeralPort() {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

main().catch((err) => {
  console.error('[google-auth] failed:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script in `services/brain/package.json`**

Add `"google-auth": "node src/cli/google-auth.js"` to scripts (alphabetical, after `doctor`):

```json
"scripts": {
  "start": "node src/index.js",
  "test": "node --test test/*.test.js",
  "doctor": "node src/cli/doctor.js",
  "google-auth": "node src/cli/google-auth.js",
  "check": "node --check src/index.js",
  "lint:plist": "plutil -lint $HOME/Library/LaunchAgents/com.secondbrain.brain.plist"
}
```

- [ ] **Step 3: Add root npm script in root `package.json`**

Add `"brain:google-auth": "cd services/brain && npm run google-auth"` after `brain:install`:

```json
"scripts": {
  "dev": "bash scripts/dev.sh",
  "brain:start": "cd services/brain && npm start",
  "brain:doctor": "cd services/brain && npm run doctor",
  "brain:test": "cd services/brain && npm test",
  "brain:install": "cd services/brain && npm install",
  "brain:google-auth": "cd services/brain && npm run google-auth",
  "launchd:install": "bash scripts/install-launchd.sh",
  "launchd:uninstall": "bash scripts/uninstall-launchd.sh"
}
```

- [ ] **Step 4: Sanity-check syntax**

```bash
cd services/brain && node --check src/cli/google-auth.js
cd services/brain && npm test
```

Expected: silent + 88/88 pass.

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/cli/google-auth.js services/brain/package.json package.json
git commit -m "brain: add interactive google oauth setup CLI"
```

---

### Task 9: `tools/listEvents.js` (TDD)

**Files:**
- Create: `services/brain/test/tools-listEvents.test.js`
- Create: `services/brain/src/tools/listEvents.js`

Wraps `googleapis` calendar v3 `events.list`. Args: `{ from, to, calendar_id, q }`. Returns normalized event records.

- [ ] **Step 1: Tests**

Create `services/brain/test/tools-listEvents.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { listEvents } = require('../src/tools/listEvents');

function fakeCalendar(items) {
  return {
    events: {
      list: async () => ({ data: { items } }),
    },
  };
}

test('listEvents returns normalized event records', async () => {
  const cal = fakeCalendar([
    {
      id: 'ev1',
      summary: 'Standup',
      start: { dateTime: '2026-04-29T09:00:00-07:00' },
      end: { dateTime: '2026-04-29T09:30:00-07:00' },
      attendees: [{ email: 'a@x.com' }],
      location: 'Zoom',
      description: 'daily',
    },
  ]);
  const out = await listEvents({
    calendar: cal,
    calendarIds: ['primary'],
    from: '2026-04-29T00:00:00-07:00',
    to: '2026-04-30T00:00:00-07:00',
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Standup');
  assert.equal(out[0].calendar, 'primary');
});

test('listEvents fans out across multiple calendars and merges', async () => {
  let nthCall = 0;
  const cal = {
    events: {
      list: async ({ calendarId }) => {
        nthCall += 1;
        return { data: { items: [{ id: `ev-${calendarId}`, summary: `Event ${calendarId}` }] } };
      },
    },
  };
  const out = await listEvents({
    calendar: cal,
    calendarIds: ['primary', 'work@example.com'],
    from: 'now',
    to: 'now+1d',
  });
  assert.equal(nthCall, 2);
  assert.equal(out.length, 2);
});

test('listEvents returns "not configured" sentinel when calendar is null', async () => {
  const out = await listEvents({ calendar: null, calendarIds: ['primary'], from: 'a', to: 'b' });
  assert.deepEqual(out, { error: 'google_not_configured' });
});

test('listEvents returns empty array when no events', async () => {
  const cal = fakeCalendar([]);
  const out = await listEvents({ calendar: cal, calendarIds: ['primary'], from: 'a', to: 'b' });
  assert.deepEqual(out, []);
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implementation**

Create `services/brain/src/tools/listEvents.js`:

```js
async function listEvents({ calendar, calendarIds, from, to, q }) {
  if (!calendar) {
    return { error: 'google_not_configured' };
  }
  const all = [];
  for (const calId of calendarIds) {
    const resp = await calendar.events.list({
      calendarId: calId,
      timeMin: from,
      timeMax: to,
      q,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });
    for (const ev of resp.data.items || []) {
      all.push({
        id: ev.id,
        title: ev.summary || '(no title)',
        start: ev.start?.dateTime || ev.start?.date,
        end: ev.end?.dateTime || ev.end?.date,
        attendees: (ev.attendees || []).map((a) => a.email).filter(Boolean),
        location: ev.location || '',
        description: ev.description || '',
        calendar: calId,
      });
    }
  }
  return all;
}

module.exports = { listEvents };
```

- [ ] **Step 4: Run tests, expect 92/92 pass (88 + 4)**

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/tools/listEvents.js services/brain/test/tools-listEvents.test.js
git commit -m "brain: add listEvents calendar tool with multi-calendar fanout"
```

---

### Task 10: `tools/createEvent.js` — confirm-gated write (TDD)

**Files:**
- Create: `services/brain/test/tools-createEvent.test.js`
- Create: `services/brain/src/tools/createEvent.js`

The chat-side function does **not** fire the API call directly. It stores the proposal in `state/threads.js` and returns proposal text. A separate `confirmEvent` function does the actual fire when the user replies `y`.

- [ ] **Step 1: Tests**

Create `services/brain/test/tools-createEvent.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { proposeEvent, confirmEvent } = require('../src/tools/createEvent');
const { _setPathOverride, getPending } = require('../src/state/threads');

async function tmpStateDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-cev-'));
}

test('proposeEvent stores pending action and returns proposal text', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  const out = await proposeEvent({
    threadTs: 't1',
    calendar: { events: { insert: async () => ({ data: { id: 'should-not-be-called', htmlLink: '' } }) } },
    args: {
      title: 'FormLab pitch prep',
      start: '2026-05-01T14:00:00-07:00',
      end: '2026-05-01T16:00:00-07:00',
    },
  });
  assert.match(out.text, /Propose: 'FormLab pitch prep'/);
  assert.match(out.text, /Reply `y`/);
  const pend = await getPending('t1');
  assert.ok(pend);
  assert.equal(pend.kind, 'create_event');
  await fs.rm(dir, { recursive: true, force: true });
});

test('proposeEvent returns "not configured" when calendar is null', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  const out = await proposeEvent({
    threadTs: 't1',
    calendar: null,
    args: { title: 't', start: 'a', end: 'b' },
  });
  assert.equal(out.error, 'google_not_configured');
  const pend = await getPending('t1');
  assert.equal(pend, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('confirmEvent fires events.insert when pending action exists', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  let inserted = null;
  const cal = {
    events: {
      insert: async ({ resource, calendarId }) => {
        inserted = { resource, calendarId };
        return { data: { id: 'ev123', htmlLink: 'https://cal/ev123' } };
      },
    },
  };
  await proposeEvent({
    threadTs: 't1',
    calendar: cal,
    args: { title: 'X', start: 's', end: 'e', calendarId: 'primary' },
  });
  const out = await confirmEvent({ threadTs: 't1', calendar: cal });
  assert.equal(out.id, 'ev123');
  assert.equal(out.htmlLink, 'https://cal/ev123');
  assert.equal(inserted.calendarId, 'primary');
  assert.equal(inserted.resource.summary, 'X');
  // pending action should be cleared
  const after = await getPending('t1');
  assert.equal(after, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('confirmEvent returns "no pending" when nothing to confirm', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  const out = await confirmEvent({ threadTs: 'no-such', calendar: { events: { insert: async () => {} } } });
  assert.equal(out.error, 'no_pending');
  await fs.rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implementation**

Create `services/brain/src/tools/createEvent.js`:

```js
const { setPending, getPending, clearPending } = require('../state/threads');

async function proposeEvent({ threadTs, calendar, args }) {
  if (!calendar) {
    return { error: 'google_not_configured' };
  }
  await setPending(threadTs, { kind: 'create_event', args });
  const text = formatProposal(args);
  return { text, pending: true };
}

async function confirmEvent({ threadTs, calendar }) {
  const pending = await getPending(threadTs);
  if (!pending || pending.kind !== 'create_event') {
    return { error: 'no_pending' };
  }
  const a = pending.args;
  const resp = await calendar.events.insert({
    calendarId: a.calendarId || 'primary',
    resource: {
      summary: a.title,
      description: a.description,
      location: a.location,
      start: { dateTime: a.start },
      end: { dateTime: a.end },
      attendees: (a.attendees || []).map((email) => ({ email })),
    },
  });
  await clearPending(threadTs);
  return { id: resp.data.id, htmlLink: resp.data.htmlLink };
}

function formatProposal(a) {
  const parts = [`Propose: '${a.title}'`];
  parts.push(`${a.start} → ${a.end}`);
  if (a.location) parts.push(`@${a.location}`);
  if (a.attendees && a.attendees.length) parts.push(`with ${a.attendees.join(', ')}`);
  parts.push("Reply `y` to create.");
  return parts.join(' · ');
}

module.exports = { proposeEvent, confirmEvent, formatProposal };
```

- [ ] **Step 4: Run tests, expect 96/96 pass (92 + 4)**

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/tools/createEvent.js services/brain/test/tools-createEvent.test.js
git commit -m "brain: add confirm-gated createEvent tool"
```

---

### Task 11: `slack/hydrate.js` — fetch thread history (TDD)

**Files:**
- Create: `services/brain/test/slack-hydrate.test.js`
- Create: `services/brain/src/slack/hydrate.js`

Pulls last N=20 messages of a thread via `conversations.replies` and converts them to Anthropic-shaped `messages` (alternating user/assistant). Bot's own messages → `assistant`; everyone else → `user`.

- [ ] **Step 1: Tests**

Create `services/brain/test/slack-hydrate.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { hydrateThread } = require('../src/slack/hydrate');

function fakeClient(messages) {
  return {
    conversations: {
      replies: async () => ({ messages }),
    },
  };
}

test('hydrateThread returns last N messages mapped to user/assistant', async () => {
  const client = fakeClient([
    { user: 'U1', text: 'hi', ts: '1' },
    { bot_id: 'B1', text: 'hello', ts: '2' },
    { user: 'U1', text: 'how are you', ts: '3' },
  ]);
  const out = await hydrateThread({ client, channel: 'C', threadTs: '1', botUserId: 'UBOT', limit: 20 });
  assert.deepEqual(out, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'how are you' },
  ]);
});

test('hydrateThread classifies messages by botUserId user match too', async () => {
  const client = fakeClient([
    { user: 'UBOT', text: 'agent reply', ts: '1' },
    { user: 'U1', text: 'thx', ts: '2' },
  ]);
  const out = await hydrateThread({ client, channel: 'C', threadTs: '1', botUserId: 'UBOT', limit: 20 });
  assert.equal(out[0].role, 'assistant');
  assert.equal(out[1].role, 'user');
});

test('hydrateThread returns [] on API error', async () => {
  const client = { conversations: { replies: async () => { throw new Error('rate_limited'); } } };
  const out = await hydrateThread({ client, channel: 'C', threadTs: '1', botUserId: 'UBOT', limit: 20 });
  assert.deepEqual(out, []);
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implementation**

Create `services/brain/src/slack/hydrate.js`:

```js
async function hydrateThread({ client, channel, threadTs, botUserId, limit = 20 }) {
  try {
    const resp = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit,
      inclusive: true,
    });
    const messages = (resp.messages || []).slice(-limit);
    return messages
      .filter((m) => typeof m.text === 'string' && m.text.trim() !== '')
      .map((m) => {
        const fromBot = m.bot_id || m.user === botUserId;
        return { role: fromBot ? 'assistant' : 'user', content: m.text };
      });
  } catch {
    return [];
  }
}

module.exports = { hydrateThread };
```

- [ ] **Step 4: Run tests, expect 99/99 pass (96 + 3)**

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/slack/hydrate.js services/brain/test/slack-hydrate.test.js
git commit -m "brain: add slack thread hydration helper"
```

---

### Task 12: `agent/chat.js` — tool loop (TDD)

**Files:**
- Create: `services/brain/test/agent-chat.test.js`
- Create: `services/brain/src/agent/chat.js`

Runs Sonnet tool loop with all four tools. Stops on `stop_reason !== 'tool_use'` or after 10 turns. Returns `{ replyText, stopReason, turns }`.

- [ ] **Step 1: Tests**

Create `services/brain/test/agent-chat.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { runChat } = require('../src/agent/chat');

function makeClient(turns) {
  let i = 0;
  return {
    messages: {
      create: async () => {
        const next = turns[i];
        i += 1;
        if (!next) throw new Error('client called more times than scripted');
        return next;
      },
    },
  };
}

const stubTools = {
  search_vault: async () => [{ path: '00_Inbox/x.md', line: 1, snippet: 'hit', frontmatter: {}, mtime: new Date() }],
  read_note: async () => ({ frontmatter: {}, body: 'note body' }),
  list_events: async () => [],
  propose_event: async () => ({ text: 'Propose: ... Reply `y` to create.', pending: true }),
};

test('runChat returns text response after a single end_turn turn', async () => {
  const client = makeClient([
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'no matches in your vault' }] },
  ]);
  const out = await runChat({
    client,
    model: 'm',
    systemPrompt: 'sys',
    history: [{ role: 'user', content: 'find X' }],
    tools: stubTools,
    timezone: 'America/Los_Angeles',
  });
  assert.match(out.replyText, /no matches/);
  assert.equal(out.turns, 1);
});

test('runChat invokes a tool then returns text on next turn', async () => {
  const client = makeClient([
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'u1', name: 'search_vault', input: { query: 'safe' } }],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'found 1 hit' }] },
  ]);
  const out = await runChat({
    client,
    model: 'm',
    systemPrompt: 'sys',
    history: [{ role: 'user', content: 'find safe notes' }],
    tools: stubTools,
    timezone: 'UTC',
  });
  assert.match(out.replyText, /found 1 hit/);
  assert.equal(out.turns, 2);
});

test('runChat aborts after 10 tool-use turns to prevent runaway', async () => {
  const turns = [];
  for (let i = 0; i < 11; i++) {
    turns.push({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: `u${i}`, name: 'search_vault', input: { query: 'x' } }],
    });
  }
  const client = makeClient(turns);
  const out = await runChat({
    client,
    model: 'm',
    systemPrompt: 'sys',
    history: [{ role: 'user', content: 'go' }],
    tools: stubTools,
    timezone: 'UTC',
  });
  assert.match(out.replyText, /tool turn limit/i);
  assert.equal(out.turns, 10);
});

test('runChat surfaces tool errors to the model as tool_result content', async () => {
  const client = makeClient([
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'u1', name: 'list_events', input: {} }],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'cal not configured' }] },
  ]);
  const tools = {
    ...stubTools,
    list_events: async () => ({ error: 'google_not_configured' }),
  };
  const out = await runChat({
    client,
    model: 'm',
    systemPrompt: 'sys',
    history: [{ role: 'user', content: 'whats on calendar' }],
    tools,
    timezone: 'UTC',
  });
  assert.match(out.replyText, /not configured/i);
  assert.equal(out.turns, 2);
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implementation**

Create `services/brain/src/agent/chat.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts/chat.md'), 'utf8');
const MAX_TURNS = 10;

const TOOL_DEFINITIONS = [
  {
    name: 'search_vault',
    description: 'Search the markdown vault for a substring. Returns hits with path, line, snippet, and parsed frontmatter.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'read_note',
    description: 'Read a full note by vault-relative path. Returns frontmatter + body.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'list_events',
    description: 'List Google Calendar events between two ISO timestamps.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO 8601 inclusive start' },
        to: { type: 'string', description: 'ISO 8601 exclusive end' },
        q: { type: 'string' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'propose_event',
    description: 'Propose a Google Calendar event. The user must reply `y` for it to fire. Always quote the title, start, end, and timezone in your final reply.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601 with timezone' },
        end: { type: 'string', description: 'ISO 8601 with timezone' },
        description: { type: 'string' },
        location: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' } },
        calendarId: { type: 'string' },
      },
      required: ['title', 'start', 'end'],
    },
  },
];

async function runChat({ client, model, systemPrompt, history, tools, timezone }) {
  const sys = `${systemPrompt || SYSTEM_PROMPT}\n\nCurrent local timezone: ${timezone}`;
  const messages = [...history];
  let turns = 0;
  let replyText = '';

  while (turns < MAX_TURNS) {
    turns += 1;
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      system: sys,
      tools: TOOL_DEFINITIONS,
      messages,
    });

    if (resp.stop_reason === 'tool_use') {
      const toolBlocks = resp.content.filter((b) => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: resp.content });
      const toolResults = [];
      for (const tb of toolBlocks) {
        const fn = tools[tb.name];
        let result;
        if (typeof fn !== 'function') {
          result = { error: `unknown tool: ${tb.name}` };
        } else {
          try {
            result = await fn(tb.input || {});
          } catch (err) {
            result = { error: err.message };
          }
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tb.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    const textBlock = (resp.content || []).find((b) => b.type === 'text');
    replyText = textBlock?.text || '';
    return { replyText, stopReason: resp.stop_reason, turns };
  }

  return {
    replyText: 'Reached tool turn limit (10). Try a more specific question.',
    stopReason: 'max_turns',
    turns,
  };
}

module.exports = { runChat, TOOL_DEFINITIONS };
```

- [ ] **Step 4: Run tests, expect 103/103 pass (99 + 4)**

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/agent/chat.js services/brain/test/agent-chat.test.js
git commit -m "brain: add chat tool loop with search_vault, read_note, list_events, propose_event"
```

---

### Task 13: Wire chat into Slack adapter (TDD)

**Files:**
- Modify: `services/brain/src/slack/adapter.js`
- Modify: `services/brain/test/slack-adapter.test.js`

The adapter now:

1. **Pre-classifier check**: if the incoming message is `y`/`yes` AND there's a pending action for the thread, fire `confirmEvent` and reply with the result. Skip classifier and capture path.
2. Otherwise classify.
3. `capture` → existing path (Slice 2).
4. `question` → run chat, post reply.
5. `both` → run capture path (silent ack-style), then run chat.

`buildHandlers` gains: `chat: { client, model }`, `googleCalendar` (or null), `botUserId`, `timezone`, `defaultCalendarIds`. `buildApp` constructs all of these from config + auth helpers.

- [ ] **Step 1: Update tests**

Replace `services/brain/test/slack-adapter.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { buildHandlers } = require('../src/slack/adapter');
const { _setPathOverride } = require('../src/state/threads');

async function tmpVault() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-slack-'));
}

async function tmpStateDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-state-'));
}

function fakeAnthropicTagOnly(toolInput) {
  return {
    messages: {
      create: async () => ({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'save_tags', input: toolInput }],
      }),
    },
  };
}

function fakeAnthropicScripted(scripts) {
  let i = 0;
  return {
    messages: {
      create: async () => {
        const next = scripts[i];
        i += 1;
        if (!next) throw new Error('exhausted scripts');
        return next;
      },
    },
  };
}

const stubEntities = { projects: ['FormLab AI'], areas: [], people: [], entities: [], flat: ['FormLab AI'] };

function makeBuilder(opts = {}) {
  const tagInput = opts.tagInput || {
    type: 'idea',
    tags: ['x'],
    mentions: [],
    summary: 's',
    suggested_para: '00_Inbox',
  };
  return {
    vaultPath: opts.vaultPath,
    allowedUserIds: opts.allowedUserIds || [],
    anthropic: {
      classifyClient: opts.classifyClient || fakeAnthropicScripted([
        { content: [{ type: 'tool_use', name: 'classify', input: { verdict: opts.verdict || 'capture' } }] },
      ]),
      classifyModel: 'haiku',
      tagClient: opts.tagClient || fakeAnthropicTagOnly(tagInput),
      tagModel: 'haiku',
      chatClient: opts.chatClient || fakeAnthropicScripted([
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'reply text' }] },
      ]),
      chatModel: 'sonnet',
    },
    scanEntities: async () => stubEntities,
    googleCalendar: opts.googleCalendar || null,
    botUserId: opts.botUserId || 'UBOT',
    timezone: 'America/Los_Angeles',
    defaultCalendarIds: ['primary'],
    hydrateThread: async () => [],
  };
}

test('capture path: classifier=capture writes file and acks with tag info', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, verdict: 'capture' }));
  await handlers.onMessage({
    message: { channel: 'D1', channel_type: 'im', user: 'U1', text: 'rep counter idea', ts: '1' },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  const files = await fs.readdir(path.join(vault, '00_Inbox'));
  assert.equal(files.length, 1);
  assert.match(acks[0].text, /Saved as idea/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('question path: classifier=question runs chat and posts reply (no capture)', async () => {
  const vault = await tmpVault();
  const stateDir = await tmpStateDir();
  _setPathOverride(path.join(stateDir, 'threads.json'));
  const acks = [];
  const handlers = buildHandlers(makeBuilder({
    vaultPath: vault,
    classifyClient: fakeAnthropicScripted([
      { content: [{ type: 'tool_use', name: 'classify', input: { verdict: 'question' } }] },
    ]),
    chatClient: fakeAnthropicScripted([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'no matches in your vault' }] },
    ]),
  }));
  await handlers.onMessage({
    message: { channel: 'D1', channel_type: 'im', user: 'U1', text: 'find safe notes', ts: '1' },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  assert.equal(acks.length, 1);
  assert.match(acks[0].text, /no matches/);
  await fs.rm(vault, { recursive: true, force: true });
  await fs.rm(stateDir, { recursive: true, force: true });
});

test('both path: classifier=both writes file then runs chat (two acks)', async () => {
  const vault = await tmpVault();
  const stateDir = await tmpStateDir();
  _setPathOverride(path.join(stateDir, 'threads.json'));
  const acks = [];
  const handlers = buildHandlers(makeBuilder({
    vaultPath: vault,
    classifyClient: fakeAnthropicScripted([
      { content: [{ type: 'tool_use', name: 'classify', input: { verdict: 'both' } }] },
    ]),
    chatClient: fakeAnthropicScripted([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'related to formlab' }] },
    ]),
  }));
  await handlers.onMessage({
    message: { channel: 'D1', channel_type: 'im', user: 'U1', text: 'idea X — does this match Y', ts: '1' },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  const files = await fs.readdir(path.join(vault, '00_Inbox'));
  assert.equal(files.length, 1);
  assert.equal(acks.length, 2);
  assert.match(acks[0].text, /Saved as/);
  assert.match(acks[1].text, /related to formlab/);
  await fs.rm(vault, { recursive: true, force: true });
  await fs.rm(stateDir, { recursive: true, force: true });
});

test('confirm gate: y reply fires pending event and skips classify', async () => {
  const vault = await tmpVault();
  const stateDir = await tmpStateDir();
  _setPathOverride(path.join(stateDir, 'threads.json'));
  const { setPending } = require('../src/state/threads');
  await setPending('t1', { kind: 'create_event', args: { title: 'X', start: 'a', end: 'b', calendarId: 'primary' } });
  const acks = [];
  const cal = { events: { insert: async () => ({ data: { id: 'ev', htmlLink: 'https://link' } }) } };
  const handlers = buildHandlers(makeBuilder({
    vaultPath: vault,
    googleCalendar: cal,
    classifyClient: { messages: { create: async () => { throw new Error('classifier should not fire'); } } },
  }));
  await handlers.onMessage({
    message: { channel: 'D1', channel_type: 'im', user: 'U1', text: 'y', ts: '2', thread_ts: 't1' },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  assert.equal(acks.length, 1);
  assert.match(acks[0].text, /Created/);
  assert.match(acks[0].text, /https:\/\/link/);
  await fs.rm(vault, { recursive: true, force: true });
  await fs.rm(stateDir, { recursive: true, force: true });
});

test('disallowed user: no capture, no chat, no ack', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, allowedUserIds: ['U1'] }));
  await handlers.onMessage({
    message: { channel: 'D1', channel_type: 'im', user: 'U_BAD', text: 'hi', ts: '1' },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  assert.equal(acks.length, 0);
  await fs.rm(vault, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Replace `services/brain/src/slack/adapter.js`**

```js
const path = require('node:path');
const { App } = require('@slack/bolt');
const { writeCapture } = require('../capture/writeInbox');
const { writeNote } = require('../tools/writeNote');
const { ack } = require('./reply');
const { classifyMessage } = require('../agent/classify');
const { tagCapture } = require('../agent/tag');
const { runChat } = require('../agent/chat');
const { scanEntities: realScanEntities } = require('../util/entities');
const { hydrateThread: realHydrateThread } = require('./hydrate');
const { buildClient } = require('../agent/anthropic');
const { searchVault } = require('../tools/searchVault');
const { readNote } = require('../tools/readNote');
const { listEvents } = require('../tools/listEvents');
const { proposeEvent, confirmEvent } = require('../tools/createEvent');
const { getPending } = require('../state/threads');
const { loadGoogleAuth } = require('../google/auth');
const { google } = require('googleapis');

const CONFIRM_TOKENS = new Set(['y', 'yes', 'Y', 'YES']);

function buildHandlers(deps) {
  const {
    vaultPath,
    allowedUserIds,
    anthropic,
    scanEntities,
    googleCalendar,
    botUserId,
    timezone,
    defaultCalendarIds,
    hydrateThread,
  } = deps;

  const isAllowed = (userId) => {
    if (!userId) return false;
    if (allowedUserIds.length === 0) return true;
    return allowedUserIds.includes(userId);
  };

  async function tryConfirmFlow({ text, threadTs, channelId, slackClient }) {
    if (!CONFIRM_TOKENS.has(text.trim())) return false;
    const pending = await getPending(threadTs);
    if (!pending) return false;
    if (pending.kind === 'create_event') {
      const out = await confirmEvent({ threadTs, calendar: googleCalendar });
      const replyText = out.error
        ? `Could not create event: ${out.error}`
        : `Created. ${out.htmlLink}`;
      await ack(slackClient, { channel: channelId, threadTs, text: replyText });
      return true;
    }
    return false;
  }

  async function capturePath({ text, userId, ts, channelType, channelId, threadTs, slackClient, logger }) {
    const filePath = await writeCapture({
      vaultPath, text, userId, ts, channelType, channelId,
    });
    logger.info?.(`capture written: ${filePath}`);
    let tags = null;
    try {
      const entities = await scanEntities(vaultPath);
      tags = await tagCapture({
        client: anthropic.tagClient,
        model: anthropic.tagModel,
        text,
        entities,
      });
    } catch (err) {
      logger.warn?.(`tag pass failed: ${err.message}`);
    }
    if (tags) {
      const relPath = path.relative(vaultPath, filePath);
      await writeNote({
        vaultPath, relPath,
        frontmatter: {
          type: tags.type, tags: tags.tags, mentions: tags.mentions,
          summary: tags.summary, suggested_para: tags.suggested_para,
        },
        body: `${text.trim()}\n`,
        overwrite: true,
      });
      await ack(slackClient, { channel: channelId, threadTs, text: formatTagAck(tags) });
    } else {
      await ack(slackClient, { channel: channelId, threadTs, text: '✓ Saved (tagging unavailable)' });
    }
  }

  async function chatPath({ text, threadTs, channelId, slackClient, logger }) {
    const history = await hydrateThread({
      client: slackClient, channel: channelId, threadTs, botUserId,
    });
    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      history.push({ role: 'user', content: text });
    }
    const tools = {
      search_vault: async ({ query }) => {
        return searchVault({ vaultPath, query });
      },
      read_note: async ({ path: relPath }) => {
        return readNote({ vaultPath, relPath });
      },
      list_events: async ({ from, to, q }) => {
        return listEvents({ calendar: googleCalendar, calendarIds: defaultCalendarIds, from, to, q });
      },
      propose_event: async (args) => {
        return proposeEvent({ threadTs, calendar: googleCalendar, args });
      },
    };
    const out = await runChat({
      client: anthropic.chatClient,
      model: anthropic.chatModel,
      history,
      tools,
      timezone,
    });
    await ack(slackClient, { channel: channelId, threadTs, text: out.replyText });
  }

  async function dispatch({ text, userId, ts, channelType, channelId, threadTs, slackClient, logger }) {
    const handled = await tryConfirmFlow({ text, threadTs, channelId, slackClient });
    if (handled) return;
    const verdict = await classifyMessage({
      client: anthropic.classifyClient,
      model: anthropic.classifyModel,
      text,
    });
    if (verdict === 'capture' || verdict === 'both') {
      await capturePath({ text, userId, ts, channelType, channelId, threadTs, slackClient, logger });
    }
    if (verdict === 'question' || verdict === 'both') {
      await chatPath({ text, threadTs, channelId, slackClient, logger });
    }
  }

  async function onMessage({ message, client, logger }) {
    try {
      if (message.subtype || message.bot_id) return;
      if (!message.user) return;
      if (!isAllowed(message.user)) {
        logger.warn?.(`ignoring message from ${message.user}`);
        return;
      }
      if (message.channel_type !== 'im' && !(message.channel || '').startsWith('D')) {
        return;
      }
      const text = (message.text || '').trim();
      if (!text) return;
      await dispatch({
        text,
        userId: message.user,
        ts: message.ts,
        channelType: 'dm',
        channelId: message.channel,
        threadTs: message.thread_ts || message.ts,
        slackClient: client,
        logger,
      });
    } catch (err) {
      logger.error?.(err);
    }
  }

  async function onAppMention({ event, client, logger }) {
    try {
      if (!isAllowed(event.user)) return;
      const text = stripLeadingMentions(event.text);
      if (!text) return;
      await dispatch({
        text,
        userId: event.user,
        ts: event.ts,
        channelType: 'channel',
        channelId: event.channel,
        threadTs: event.thread_ts || event.ts,
        slackClient: client,
        logger,
      });
    } catch (err) {
      logger.error?.(err);
    }
  }

  return { onMessage, onAppMention };
}

function formatTagAck(tags) {
  const parts = [`✓ Saved as ${tags.type}`];
  if (tags.tags && tags.tags.length) parts.push(`tags: ${tags.tags.join(', ')}`);
  if (tags.mentions && tags.mentions.length) parts.push(`linked: ${tags.mentions.join(' ')}`);
  return parts.join(' · ');
}

function stripLeadingMentions(text) {
  return (text || '').replace(/<@[^>]+>\s*/g, '').trim();
}

async function buildApp({ config }) {
  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
  });

  const anthropicClient = buildClient({ apiKey: config.anthropic.apiKey });

  // Resolve the bot's user ID once at startup so hydrateThread can identify assistant messages.
  let botUserId = null;
  try {
    const auth = await app.client.auth.test();
    botUserId = auth.user_id;
  } catch (err) {
    console.warn('[adapter] could not resolve bot user_id:', err.message);
  }

  const oauthClient = await loadGoogleAuth({ google: config.google });
  const googleCalendar = oauthClient
    ? google.calendar({ version: 'v3', auth: oauthClient })
    : null;

  const handlers = buildHandlers({
    vaultPath: config.vaultPath,
    allowedUserIds: config.allowedUserIds,
    anthropic: {
      classifyClient: anthropicClient,
      classifyModel: config.anthropic.classifyModel,
      tagClient: anthropicClient,
      tagModel: config.anthropic.tagModel,
      chatClient: anthropicClient,
      chatModel: config.anthropic.chatModel,
    },
    scanEntities: realScanEntities,
    googleCalendar,
    botUserId,
    timezone: config.timezone,
    defaultCalendarIds: config.defaultCalendarIds,
    hydrateThread: realHydrateThread,
  });

  app.message(async (args) => handlers.onMessage(args));
  app.event('app_mention', async (args) => handlers.onAppMention(args));

  return app;
}

module.exports = { buildApp, buildHandlers, stripLeadingMentions, formatTagAck };
```

- [ ] **Step 4: Update `services/brain/src/index.js` to await `buildApp`**

`buildApp` is now async. Read current file. The bootstrap calls `const app = buildApp({ config })`. Change to `const app = await buildApp({ config })`.

- [ ] **Step 5: Run tests, expect failure-then-pass**

Some prior slack-adapter tests had different signature; the new test file replaces all of them. Total test count: 103 (Slice 2.5 Task 12 end) − 5 (old slack-adapter tests removed) + 5 (new slack-adapter tests) = 103. Verify.

Run: `cd services/brain && npm test`. Expected: 103/103 pass.

- [ ] **Step 6: Commit**

```bash
git add services/brain/src/slack/adapter.js services/brain/src/index.js services/brain/test/slack-adapter.test.js
git commit -m "brain: route question/both verdicts through chat tool loop; add y-confirm gate"
```

---

### Task 14: Doctor — optional Google check (TDD)

**Files:**
- Modify: `services/brain/src/cli/doctor.js`
- Modify: `services/brain/test/doctor.test.js`

Adds a `google` check. When the env block is unset, it shows `skipped (Google Calendar not configured)`. When set but token missing, FAIL with "run `npm run brain:google-auth`". When set and token present, PASS via `calendar.calendars.get('primary')`.

- [ ] **Step 1: Update tests**

Edit `services/brain/test/doctor.test.js`. Add `fetchGoogleAuth: async () => ({ ok: true, configured: true })` to every existing `runDoctor` call. Then append three new tests:

```js
test('doctor SKIPS google check when unconfigured', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
    ANTHROPIC_API_KEY: 'sk-ant-test',
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true }),
    fetchAnthropicAuth: async () => ({ ok: true }),
    fetchGoogleAuth: async () => ({ ok: true, configured: false }),
  });
  const g = checks.find((c) => c.name === 'google');
  assert.equal(g.ok, true);
  assert.match(g.message, /not configured/i);
  await fs.rm(vault, { recursive: true, force: true });
});

test('doctor PASSes google when token works', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
    ANTHROPIC_API_KEY: 'sk-ant-test',
    GOOGLE_OAUTH_CLIENT_ID: 'cid',
    GOOGLE_OAUTH_CLIENT_SECRET: 'sec',
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true }),
    fetchAnthropicAuth: async () => ({ ok: true }),
    fetchGoogleAuth: async () => ({ ok: true, configured: true }),
  });
  const g = checks.find((c) => c.name === 'google');
  assert.equal(g.ok, true);
  await fs.rm(vault, { recursive: true, force: true });
});

test('doctor FAILs google when token is bad', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
    ANTHROPIC_API_KEY: 'sk-ant-test',
    GOOGLE_OAUTH_CLIENT_ID: 'cid',
    GOOGLE_OAUTH_CLIENT_SECRET: 'sec',
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true }),
    fetchAnthropicAuth: async () => ({ ok: true }),
    fetchGoogleAuth: async () => ({ ok: false, configured: true, error: 'invalid_grant' }),
  });
  const g = checks.find((c) => c.name === 'google');
  assert.equal(g.ok, false);
  assert.match(g.message, /invalid_grant/);
  await fs.rm(vault, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Update `services/brain/src/cli/doctor.js`**

Read the current doctor.js. Add the `google` check after the `anthropic` check, then add a `realFetchGoogleAuth` real-call function and wire into `cli()`.

The check block:

```js
let gOk = false;
let gMsg = '';
const googleConfigured = Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
if (!googleConfigured) {
  gOk = true;
  gMsg = 'not configured (calendar features disabled — set GOOGLE_OAUTH_* to enable)';
} else {
  try {
    const auth = await fetchGoogleAuth(env);
    if (auth.configured && auth.ok) {
      gOk = true;
      gMsg = 'auth ok';
    } else if (auth.configured && !auth.ok) {
      gMsg = `auth failed: ${auth.error || 'unknown'}`;
    } else {
      gOk = true;
      gMsg = 'not configured';
    }
  } catch (err) {
    gMsg = `auth call threw: ${err.message}`;
  }
}
checks.push({ name: 'google', ok: gOk, message: gMsg });
```

Add `realFetchGoogleAuth`:

```js
async function realFetchGoogleAuth(env) {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return { ok: true, configured: false };
  }
  try {
    const { google } = require('googleapis');
    const { loadGoogleAuth } = require('../google/auth');
    const oauth = await loadGoogleAuth({
      google: { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET },
    });
    if (!oauth) {
      return { ok: false, configured: true, error: 'token file missing — run `npm run brain:google-auth`' };
    }
    const cal = google.calendar({ version: 'v3', auth: oauth });
    await cal.calendars.get({ calendarId: 'primary' });
    return { ok: true, configured: true };
  } catch (err) {
    return { ok: false, configured: true, error: err.message };
  }
}
```

In `cli()`, add `fetchGoogleAuth: realFetchGoogleAuth` to the `runDoctor` call.

The `runDoctor` signature takes a new `fetchGoogleAuth` parameter:

```js
async function runDoctor({ env, fetchSlackAuth, fetchAnthropicAuth, fetchGoogleAuth }) {
```

- [ ] **Step 4: Run tests, expect 106/106 pass (103 + 3)**

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/cli/doctor.js services/brain/test/doctor.test.js
git commit -m "brain: doctor checks google calendar (graceful when not configured)"
```

---

### Task 15: README + CLAUDE.md updates

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

Document the chat behavior, the new env vars, the OAuth setup, and the `y`-confirm flow.

- [ ] **Step 1: README — add a "Chat" section, update env block, add Google setup**

Edit `README.md`. After the "What it does today" section, replace it (or amend). The current section describes Slice 2 capture+tag. Update to include chat:

(a) Replace the env block under "Configure environment" to add Google vars:

```ini
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
VAULT_PATH=/absolute/path/to/this/repo/vault
ANTHROPIC_API_KEY=sk-ant-...
ALLOWED_SLACK_USER_IDS=U12345

# Optional — enable calendar tools:
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
DEFAULT_CALENDAR_IDS=primary
```

(b) Add a new section after "What it does today" called "Chat":

```markdown
## Chat

You can also ask the brain things. Each Slack message is classified as `capture` (drop a thought), `question` (ask the agent), or `both`. Examples:

- `find my notes on SAFEs` → searches `vault/` and replies with hits.
- `what's on my calendar tomorrow?` → reads Google Calendar (if configured).
- `block 2 hours Thursday for FormLab pitch` → proposes the event and asks you to reply `y` to confirm. Only `y`/`yes` actually creates it.

Conversation memory is the Slack thread itself — replies in the same thread keep context; a fresh top-level DM starts a new conversation.
```

(c) Add a new section "Connect Google Calendar (optional)" after "Run as a background service":

```markdown
## Connect Google Calendar (optional)

The brain works without Google. To enable calendar tools:

1. **Create OAuth credentials.** Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), enable the **Google Calendar API**, then create an **OAuth client ID** of type **Desktop app**. Copy the client ID and secret into `services/brain/.env`:

   ```ini
   GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=...
   ```

2. **Authorize once:**

   ```bash
   npm run brain:google-auth
   ```

   The script opens a local URL; click it, sign in with the Google account whose calendar you want, and approve. The refresh token is saved to `~/.config/secondbrain/google-token.json` (mode 0600).

3. **Restart the brain.** `npm run brain:doctor` should now show `[PASS] google`.

If `brain:google-auth` ever returns "no refresh_token", revoke prior consent at <https://myaccount.google.com/permissions> and re-run.
```

- [ ] **Step 2: CLAUDE.md — add chat behavior notes**

After the "Frontmatter conventions" section, add:

```markdown
## Chat behavior

- Each Slack message is classified `capture | question | both`. Captures land in `00_Inbox/` with a Haiku tag pass; questions go through a Sonnet tool loop with `search_vault`, `read_note`, `list_events`, `propose_event`.
- Calendar writes are gated: the agent always proposes; the user must reply `y` in the same thread for it to fire.
- Pending confirm actions live in `services/brain/.state/threads.json` and expire after 10 minutes.
- Conversation memory: last 20 messages of the Slack thread, hydrated via `conversations.replies`.
```

- [ ] **Step 3: Sanity-check + tests**

```bash
grep -n GOOGLE_OAUTH README.md
grep -n "Chat behavior" CLAUDE.md
cd services/brain && npm test
```

Expected: hits in both files; 106/106 pass.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document chat path, calendar setup, y-confirm flow"
```

---

### Task 16: Manual end-to-end smoke (USER)

This task is not run by an automated worker — it requires real Slack, real Anthropic, and (optionally) real Google. Pause execution and present the checklist.

**Files:** none changed.

- [ ] **Step 1: Bring code up to date**

```bash
cd "/Users/jameshu8/Desktop/2nd Brain"
npm run brain:install
```

- [ ] **Step 2: (Optional) Set up Google Calendar**

If you want calendar features:

1. Add `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` to `services/brain/.env`.
2. Run `npm run brain:google-auth`. Click the URL, approve in browser.
3. Confirm: `npm run brain:doctor` shows `[PASS] google`.

If you skip this, calendar prompts will respond "not configured".

- [ ] **Step 3: Restart the brain**

```bash
launchctl kickstart -k gui/$(id -u)/com.secondbrain.brain
```

(Or `npm run brain:start` if you're running interactively.)

- [ ] **Step 4: Smoke a question**

DM the bot: `find my notes on SAFEs`

Expected: a single reply with a list of hits (paths and short snippets) from your vault, or "no matches" if there are none.

- [ ] **Step 5: Smoke a calendar query (Google only)**

DM: `what's on my calendar today?`

Expected: a list of events for today from your primary calendar.

- [ ] **Step 6: Smoke a calendar create + confirm flow (Google only)**

DM: `block 30 minutes tomorrow at 4pm for testing the brain`

Expected: a proposal reply like `Propose: 'testing the brain' 2026-04-30T16:00:00-07:00 → 2026-04-30T16:30:00-07:00 · Reply 'y' to create.`

Reply `y` in the same thread.

Expected: `Created. https://calendar.google.com/...` and the event appears in your calendar.

- [ ] **Step 7: Smoke a "both" message**

DM: `idea: rep counter via pose estimation — does this overlap with FormLab?`

Expected: TWO replies in the thread — first the capture ack (`✓ Saved as idea · ...`), then the chat reply with vault search results referencing FormLab notes.

- [ ] **Step 8: Tail logs if anything's off**

```bash
tail -f ~/Library/Logs/secondbrain/brain.log
```

---

## Self-review (filled in by plan author)

**Spec coverage** (vs. spec sections "Question path (chat)" and "Calendar integration"):

- Slack thread = session, last 20 messages → Task 11 ✓
- Tool loop with search_vault, read_note, list_events, create_event → Tasks 5, 6, 9, 10 ✓
- Write-confirm rule (propose-then-`y`) → Tasks 10, 13 ✓
- Pending action state in `threads.json`, 10-min TTL → Task 2 ✓
- System prompt with rules + timezone → Task 4 ✓
- Streaming = none, single reply → Task 12 (post once) ✓
- Real classifier returning `capture | question | both` → Task 3 ✓
- Google OAuth one-time setup with refresh token persisted → Task 8 ✓
- Multi-calendar via DEFAULT_CALENDAR_IDS → Tasks 1, 9 ✓
- Time zone handling via host TZ → Tasks 1, 12 ✓
- Doctor reports Google status (graceful when unset) → Task 14 ✓
- `synthesize_status` → **deferred to Slice 3**, intentional per slice scope.

**Placeholder scan:** none.

**Type/name consistency:**
- `runChat({ client, model, history, tools, timezone })` consistent across Tasks 12, 13.
- `classifyMessage({ client, model, text })` consistent across Tasks 3, 13.
- `tagCapture({ client, model, text, entities })` (from Slice 2) used unchanged in Task 13.
- `searchVault({ vaultPath, query })` consistent across Tasks 5, 13.
- `readNote({ vaultPath, relPath })` consistent across Tasks 6, 13.
- `listEvents({ calendar, calendarIds, from, to, q })` consistent across Tasks 9, 13.
- `proposeEvent / confirmEvent({ threadTs, calendar, args? })` consistent across Tasks 10, 13.
- `setPending / getPending / clearPending` consistent across Tasks 2, 10, 13.
- `loadGoogleAuth({ google, tokenPath? })` consistent across Tasks 7, 13, 14.
- `hydrateThread({ client, channel, threadTs, botUserId, limit? })` consistent across Tasks 11, 13.
- Test counts: each task increments tests; final target ≈ 106 after Task 14.

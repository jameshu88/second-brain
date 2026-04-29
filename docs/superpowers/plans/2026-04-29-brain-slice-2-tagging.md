# Conversational Brain — Slice 2 (Capture-Time Tagging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Slack message lands, the brain runs a Haiku tag pass against the message text + a cached vault-entity list, merges `type`, `tags`, `mentions`, `summary`, and `suggested_para` into the note's frontmatter, and posts a one-line threaded Slack ack like `✓ Saved as idea · tags: pose-estimation, formlab · linked: [[FormLab AI]]`. Tag failures are graceful — the note is still saved with base frontmatter only.

**Architecture:** Anthropic Claude Haiku 4.5 via `@anthropic-ai/sdk` using tool-use for structured output. A new `agent/` module owns LLM calls (tag pass, classifier stub). A new `util/entities.js` scans the vault for known entity names with a 1-hour in-process cache. The Slack adapter's capture flow grows three steps: `classify → capture → tag-and-ack`.

**Tech Stack:** Node 18+, `@anthropic-ai/sdk`, existing utilities from Slice 1 (`paths`, `frontmatter`, `writeNote`).

**Source spec:** `docs/superpowers/specs/2026-04-28-conversational-brain-design.md` (Section "Capture path" + "Architectural decisions").

**Out of scope for this slice:** Question/chat path, status synthesis, calendar, daily batch, real classifier (still always-capture). These ship in Slice 2.5+ per the revised phasing.

---

### Task 1: Anthropic SDK + env var + config

**Files:**
- Modify: `services/brain/package.json` (add `@anthropic-ai/sdk` dep)
- Modify: `services/brain/.env.example` (add `ANTHROPIC_API_KEY`)
- Modify: `services/brain/src/config.js` (require + expose `anthropic.apiKey`, model IDs)
- Modify: `services/brain/test/config.test.js` (test for new required var + exposed shape)

- [ ] **Step 1: Add the dep**

In `services/brain/package.json`, add `"@anthropic-ai/sdk": "^0.32.0"` to dependencies (alphabetical, after `@slack/web-api`):

```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.32.0",
  "@slack/bolt": "^3.22.0",
  "@slack/web-api": "^7.0.0",
  "dotenv": "^16.4.5",
  "js-yaml": "^4.1.0"
}
```

Then `cd services/brain && npm install`.

- [ ] **Step 2: Append the new env var to `.env.example`**

Add after the Vault block, before Access control:

```
# --- LLM ---
# Anthropic API key for tagging (Slice 2) and chat (Slice 2.5+).
# Get one at https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 3: Update `services/brain/test/config.test.js`**

Add `ANTHROPIC_API_KEY: 'sk-ant-test'` to the `BASE` env constant (so existing tests still pass), and add three new tests:

```js
test('loadConfig exposes anthropic.apiKey and model defaults', () => {
  const cfg = loadConfig(BASE);
  assert.equal(cfg.anthropic.apiKey, 'sk-ant-test');
  assert.equal(cfg.anthropic.tagModel, 'claude-haiku-4-5-20251001');
  assert.equal(cfg.anthropic.chatModel, 'claude-sonnet-4-6');
});

test('loadConfig fails fast when ANTHROPIC_API_KEY is missing', () => {
  assert.throws(() => loadConfig({ ...BASE, ANTHROPIC_API_KEY: '' }), /ANTHROPIC_API_KEY/);
});

test('loadConfig honors ANTHROPIC_TAG_MODEL override', () => {
  const cfg = loadConfig({ ...BASE, ANTHROPIC_TAG_MODEL: 'claude-haiku-future' });
  assert.equal(cfg.anthropic.tagModel, 'claude-haiku-future');
});
```

The full updated `BASE` constant is:

```js
const BASE = {
  SLACK_BOT_TOKEN: 'xoxb-x',
  SLACK_APP_TOKEN: 'xapp-x',
  SLACK_SIGNING_SECRET: 's',
  VAULT_PATH: '/tmp/some-vault',
  ANTHROPIC_API_KEY: 'sk-ant-test',
};
```

- [ ] **Step 4: Run the tests, expect failures (new tests fail until config.js updated; existing tests now fail because BASE didn't include ANTHROPIC_API_KEY before)**

Run: `cd services/brain && npm test`
Expected: tests in `config.test.js` fail; everything else still passes.

- [ ] **Step 5: Update `services/brain/src/config.js`**

Add ANTHROPIC_API_KEY to required vars and expose anthropic block:

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

- [ ] **Step 6: Run tests, expect 46/46 pass (43 prior + 3 new)**

Run: `cd services/brain && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add services/brain/package.json services/brain/package-lock.json \
        services/brain/.env.example services/brain/src/config.js \
        services/brain/test/config.test.js
git commit -m "brain: add ANTHROPIC_API_KEY config + sdk dep"
```

---

### Task 2: `util/entities.js` — vault entity scan + cache (TDD)

**Files:**
- Create: `services/brain/test/util-entities.test.js`
- Create: `services/brain/src/util/entities.js`

The tag pass needs a list of "real" entity names so it never invents wikilinks to pages that don't exist. Scan top-level subdirs of `01_Projects/` and `02_Areas/`, plus markdown file stems in `05_People/` and `06_Entities/`. Cache the result in process for `ENTITY_CACHE_TTL_MS` (default 1h).

- [ ] **Step 1: Write the failing tests**

Create `services/brain/test/util-entities.test.js`:

```js
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
  // No subdirs at all.
  const ents = await scanEntities(vault);
  assert.deepEqual(ents, { projects: [], areas: [], people: [], entities: [] });
  await fs.rm(vault, { recursive: true, force: true });
});

test('scanEntities caches results within TTL', async () => {
  _resetCache();
  const vault = await buildFixtureVault();
  const a = await scanEntities(vault);
  // Add a new project; with cache hit, scanEntities should still return the prior list.
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
  // Convenience flatten — exposed for the tag pass to drop into the system prompt.
  assert.ok(Array.isArray(ents.flat));
  assert.ok(ents.flat.includes('FormLab AI'));
  assert.ok(ents.flat.includes('James'));
  assert.ok(ents.flat.includes('Acme Corp'));
  await fs.rm(vault, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests, expect FAIL (module not found)**

Run: `cd services/brain && npm test`
Expected: failure on `util-entities.test.js`.

- [ ] **Step 3: Implement `services/brain/src/util/entities.js`**

```js
const fs = require('node:fs/promises');
const path = require('node:path');

const TTL_MS = parseInt(process.env.ENTITY_CACHE_TTL_MS || '3600000', 10) || 3600000;

let cache = null; // { vaultPath, expires, value }

/**
 * Scan a vault for known entity names that the tagger can safely wikilink to.
 * Result is cached in-process for TTL_MS to avoid hitting the filesystem on
 * every capture.
 *
 * Returns:
 *   {
 *     projects: string[],   // top-level subdirs of 01_Projects/
 *     areas: string[],      // top-level subdirs of 02_Areas/
 *     people: string[],     // markdown file stems in 05_People/
 *     entities: string[],   // markdown file stems in 06_Entities/
 *     flat: string[],       // union of all four, for prompt embedding
 *   }
 */
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
```

- [ ] **Step 4: Run tests, expect 51/51 pass (46 prior + 5 new)**

Run: `cd services/brain && npm test`

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/util/entities.js services/brain/test/util-entities.test.js
git commit -m "brain: add vault entity scanner with in-process cache"
```

---

### Task 3: `agent/anthropic.js` — SDK client factory (TDD)

**Files:**
- Create: `services/brain/test/agent-anthropic.test.js`
- Create: `services/brain/src/agent/anthropic.js`

A thin factory so tests can construct a client without hitting the network and so callers don't import the SDK directly.

- [ ] **Step 1: Write the failing tests**

Create `services/brain/test/agent-anthropic.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClient } = require('../src/agent/anthropic');

test('buildClient returns an object exposing messages.create', () => {
  const client = buildClient({ apiKey: 'sk-ant-test' });
  assert.ok(client);
  assert.equal(typeof client.messages.create, 'function');
});

test('buildClient throws when apiKey is missing', () => {
  assert.throws(() => buildClient({}), /apiKey/);
  assert.throws(() => buildClient({ apiKey: '' }), /apiKey/);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd services/brain && npm test`
Expected: module not found.

- [ ] **Step 3: Implement `services/brain/src/agent/anthropic.js`**

```js
const Anthropic = require('@anthropic-ai/sdk');

/**
 * Build an Anthropic SDK client. Wrapped so tests can mock at this seam
 * and so callers don't import @anthropic-ai/sdk directly.
 */
function buildClient({ apiKey }) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new Error('buildClient: apiKey is required');
  }
  return new Anthropic({ apiKey });
}

module.exports = { buildClient };
```

- [ ] **Step 4: Run tests, expect 53/53 pass (51 + 2)**

Run: `cd services/brain && npm test`

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/agent/anthropic.js services/brain/test/agent-anthropic.test.js
git commit -m "brain: add anthropic sdk client factory"
```

---

### Task 4: Tag pass system prompt + `agent/tag.js` (TDD)

**Files:**
- Create: `services/brain/src/agent/prompts/tag.md`
- Create: `services/brain/test/agent-tag.test.js`
- Create: `services/brain/src/agent/tag.js`

Tag pass uses Anthropic **tool use** for structured output: the model is forced to call a single `save_tags` tool with a fixed JSON schema, which we then read back. This is more reliable than asking for raw JSON.

- [ ] **Step 1: Create the system prompt**

Create `services/brain/src/agent/prompts/tag.md`:

```markdown
You are a tagging assistant for a personal PARA Obsidian vault. Given a quick note the user just captured (often a fragment or shorthand), produce concise structured tags.

Rules:
- Output is delivered exclusively via the `save_tags` tool. Always call it.
- `type` must be exactly one of: idea, task, note, decision, question.
- `tags` is a small list (0-5) of lowercase, hyphen-separated topic tags. No `#`. No spaces.
- `mentions` is a list of wikilinks **only** to entities that appear in the user's known entity list, formatted as `[[Entity Name]]`. Never invent entities.
- `summary` is a single short sentence (under 15 words) that paraphrases the note's intent.
- `suggested_para` is a vault-relative folder path that this note most plausibly belongs in (e.g. `01_Projects/FormLab AI`, `02_Areas/Engineering`, `03_Resources/Computer Vision`). It MUST start with one of: `01_Projects/`, `02_Areas/`, `03_Resources/`, `04_Archive/`. If no clear fit, return `00_Inbox` to keep it in the inbox.

Be conservative. If you're unsure about a mention or tag, omit it. The user will triage manually.
```

- [ ] **Step 2: Write the failing tests**

Create `services/brain/test/agent-tag.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { tagCapture } = require('../src/agent/tag');

function fakeClientReturning(toolInput) {
  return {
    messages: {
      create: async () => ({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 't1', name: 'save_tags', input: toolInput },
        ],
      }),
    },
  };
}

test('tagCapture returns parsed fields from save_tags tool call', async () => {
  const client = fakeClientReturning({
    type: 'idea',
    tags: ['pose-estimation', 'formlab'],
    mentions: ['[[FormLab AI]]'],
    summary: 'Idea to detect rep counting via pose estimation.',
    suggested_para: '01_Projects/FormLab AI',
  });
  const out = await tagCapture({
    client,
    model: 'claude-haiku-4-5-20251001',
    text: 'rep counter via pose estimation',
    entities: { projects: ['FormLab AI'], areas: [], people: [], entities: [], flat: ['FormLab AI'] },
  });
  assert.equal(out.type, 'idea');
  assert.deepEqual(out.tags, ['pose-estimation', 'formlab']);
  assert.deepEqual(out.mentions, ['[[FormLab AI]]']);
  assert.match(out.summary, /pose estimation/i);
  assert.equal(out.suggested_para, '01_Projects/FormLab AI');
});

test('tagCapture filters mentions not in entities.flat', async () => {
  const client = fakeClientReturning({
    type: 'idea',
    tags: [],
    mentions: ['[[FormLab AI]]', '[[InventedThing]]'],
    summary: 's',
    suggested_para: '00_Inbox',
  });
  const out = await tagCapture({
    client,
    model: 'm',
    text: 't',
    entities: { projects: ['FormLab AI'], areas: [], people: [], entities: [], flat: ['FormLab AI'] },
  });
  assert.deepEqual(out.mentions, ['[[FormLab AI]]']);
});

test('tagCapture rejects an invalid type', async () => {
  const client = fakeClientReturning({
    type: 'random_garbage',
    tags: [],
    mentions: [],
    summary: 's',
    suggested_para: '00_Inbox',
  });
  await assert.rejects(
    tagCapture({
      client,
      model: 'm',
      text: 't',
      entities: { projects: [], areas: [], people: [], entities: [], flat: [] },
    }),
    /type/i
  );
});

test('tagCapture rejects suggested_para outside known PARA roots', async () => {
  const client = fakeClientReturning({
    type: 'idea',
    tags: [],
    mentions: [],
    summary: 's',
    suggested_para: '../etc',
  });
  await assert.rejects(
    tagCapture({
      client,
      model: 'm',
      text: 't',
      entities: { projects: [], areas: [], people: [], entities: [], flat: [] },
    }),
    /suggested_para/i
  );
});

test('tagCapture surfaces upstream errors so caller can fall back', async () => {
  const client = {
    messages: {
      create: async () => { throw new Error('upstream 500'); },
    },
  };
  await assert.rejects(
    tagCapture({
      client,
      model: 'm',
      text: 't',
      entities: { projects: [], areas: [], people: [], entities: [], flat: [] },
    }),
    /upstream 500/
  );
});
```

- [ ] **Step 3: Run tests, expect FAIL**

- [ ] **Step 4: Implement `services/brain/src/agent/tag.js`**

```js
const fs = require('node:fs');
const path = require('node:path');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts/tag.md'), 'utf8');

const VALID_TYPES = new Set(['idea', 'task', 'note', 'decision', 'question']);
const VALID_PARA_ROOTS = ['01_Projects/', '02_Areas/', '03_Resources/', '04_Archive/', '00_Inbox'];

const TOOL = {
  name: 'save_tags',
  description: 'Save the structured tags for a captured note.',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['idea', 'task', 'note', 'decision', 'question'],
      },
      tags: { type: 'array', items: { type: 'string' } },
      mentions: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
      suggested_para: { type: 'string' },
    },
    required: ['type', 'tags', 'mentions', 'summary', 'suggested_para'],
  },
};

/**
 * Run the tag pass against a captured message.
 *
 * @param {object} args
 * @param {object} args.client Anthropic SDK client
 * @param {string} args.model Model id (e.g. claude-haiku-4-5-20251001)
 * @param {string} args.text  The message body
 * @param {{ flat: string[] }} args.entities From util/entities.js
 * @returns {Promise<{type, tags, mentions, summary, suggested_para}>}
 */
async function tagCapture({ client, model, text, entities }) {
  const knownEntities = entities.flat || [];
  const userMessage =
    `Known entities (use these as-is for any [[wikilink]] in mentions; do not invent others):\n` +
    knownEntities.map((e) => `- ${e}`).join('\n') +
    `\n\nNote text:\n${text}\n`;

  const resp = await client.messages.create({
    model,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'save_tags' },
    messages: [{ role: 'user', content: userMessage }],
  });

  const block = (resp.content || []).find((b) => b.type === 'tool_use' && b.name === 'save_tags');
  if (!block) {
    throw new Error('tag pass: model did not call save_tags');
  }
  const raw = block.input || {};

  if (!VALID_TYPES.has(raw.type)) {
    throw new Error(`tag pass: invalid type "${raw.type}"`);
  }
  const sp = String(raw.suggested_para || '').trim();
  if (!VALID_PARA_ROOTS.some((r) => sp === r || sp.startsWith(r))) {
    throw new Error(`tag pass: suggested_para "${sp}" outside known PARA roots`);
  }

  const allowedMentionSet = new Set(knownEntities.map((e) => `[[${e}]]`));
  const mentions = (raw.mentions || []).filter((m) => allowedMentionSet.has(m));

  return {
    type: raw.type,
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 8) : [],
    mentions,
    summary: String(raw.summary || '').trim(),
    suggested_para: sp,
  };
}

module.exports = { tagCapture, TOOL, SYSTEM_PROMPT };
```

- [ ] **Step 5: Run tests, expect 58/58 pass (53 + 5)**

Run: `cd services/brain && npm test`

- [ ] **Step 6: Commit**

```bash
git add services/brain/src/agent/prompts/tag.md \
        services/brain/src/agent/tag.js \
        services/brain/test/agent-tag.test.js
git commit -m "brain: add haiku-driven tag pass with structured-output tool use"
```

---

### Task 5: `agent/classify.js` — stub returning 'capture' (TDD)

**Files:**
- Create: `services/brain/test/agent-classify.test.js`
- Create: `services/brain/src/agent/classify.js`

Slice 2 always treats incoming messages as captures. The classifier exists as a function so Slice 2.5 can flip it to a real Haiku call without touching the Slack adapter wiring.

- [ ] **Step 1: Write the failing tests**

Create `services/brain/test/agent-classify.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMessage } = require('../src/agent/classify');

test('classifyMessage returns capture for any text in slice 2', async () => {
  const out = await classifyMessage({ text: 'rep counter via pose estimation' });
  assert.equal(out, 'capture');
});

test('classifyMessage returns capture even for question-shaped text in slice 2', async () => {
  const out = await classifyMessage({ text: 'what is on my calendar tomorrow?' });
  assert.equal(out, 'capture');
});

test('classifyMessage rejects empty text', async () => {
  await assert.rejects(classifyMessage({ text: '' }), /text/i);
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `services/brain/src/agent/classify.js`**

```js
/**
 * Classify a Slack message as 'capture' | 'question' | 'both'.
 *
 * Slice 2 stub: always returns 'capture'. Slice 2.5 will replace this body
 * with a Haiku call. The function shape is locked now so the Slack adapter
 * doesn't need to change when the classifier becomes real.
 */
async function classifyMessage({ text }) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('classifyMessage: text is required');
  }
  return 'capture';
}

module.exports = { classifyMessage };
```

- [ ] **Step 4: Run tests, expect 61/61 pass (58 + 3)**

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/agent/classify.js services/brain/test/agent-classify.test.js
git commit -m "brain: add classifier stub (slice-2 always-capture)"
```

---

### Task 6: Wire tag pass into Slack adapter (TDD)

**Files:**
- Modify: `services/brain/src/slack/adapter.js`
- Modify: `services/brain/test/slack-adapter.test.js`

The flow becomes:

```
classify(text)
  -> writeCapture(...) -> filePath
  -> tagCapture(text, entities)
       -> writeNote(filePath, frontmatter merge, overwrite=true)
       -> ack("✓ Saved as <type> · tags: ... · linked: ...")
  on tag failure:
       -> ack("✓ Saved (tagging unavailable)")
```

We pass dependencies into `buildHandlers` (Anthropic client factory + entity scanner) so tests can inject fakes.

- [ ] **Step 1: Update `services/brain/test/slack-adapter.test.js`**

Replace the file with:

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

function fakeAnthropic(toolInput) {
  return {
    messages: {
      create: async () => ({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'save_tags', input: toolInput }],
      }),
    },
  };
}

const stubEntities = { projects: ['FormLab AI'], areas: [], people: [], entities: [], flat: ['FormLab AI'] };

function makeBuilder(opts = {}) {
  const tagInput = opts.tagInput || {
    type: 'idea',
    tags: ['pose-estimation'],
    mentions: ['[[FormLab AI]]'],
    summary: 'Idea about pose estimation.',
    suggested_para: '01_Projects/FormLab AI',
  };
  const client = opts.failTag
    ? { messages: { create: async () => { throw new Error('tag pass died'); } } }
    : fakeAnthropic(tagInput);
  return {
    vaultPath: opts.vaultPath,
    allowedUserIds: opts.allowedUserIds || [],
    anthropic: { client, model: 'claude-haiku-4-5-20251001' },
    scanEntities: async () => stubEntities,
  };
}

test('DM handler writes capture, tags it, and posts ack with tag info', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, allowedUserIds: ['U1'] }));
  await handlers.onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      user: 'U1',
      text: 'rep counter via pose estimation',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  const inbox = path.join(vault, '00_Inbox');
  const files = await fs.readdir(inbox);
  assert.equal(files.length, 1);
  const content = await fs.readFile(path.join(inbox, files[0]), 'utf8');
  assert.match(content, /type: idea/);
  assert.match(content, /pose-estimation/);
  assert.match(content, /\[\[FormLab AI\]\]/);
  assert.match(content, /summary: /);
  assert.match(content, /suggested_para: /);
  assert.equal(acks.length, 1);
  assert.match(acks[0].text, /Saved as idea/);
  assert.match(acks[0].text, /pose-estimation/);
  assert.match(acks[0].text, /\[\[FormLab AI\]\]/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('DM handler still saves and acks gracefully when tag pass fails', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, allowedUserIds: [], failTag: true }));
  await handlers.onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      user: 'U1',
      text: 'fragment thought',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  const files = await fs.readdir(path.join(vault, '00_Inbox'));
  assert.equal(files.length, 1);
  const content = await fs.readFile(path.join(vault, '00_Inbox', files[0]), 'utf8');
  assert.match(content, /source: slack/);
  assert.doesNotMatch(content, /type:/); // no tag fields when tag pass fails
  assert.equal(acks.length, 1);
  assert.match(acks[0].text, /Saved \(tagging unavailable\)/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('DM handler ignores disallowed user (no capture, no ack)', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, allowedUserIds: ['U1'] }));
  await handlers.onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      user: 'U_BAD',
      text: 'hi',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  assert.equal(acks.length, 0);
  await fs.rm(vault, { recursive: true, force: true });
});

test('DM handler ignores bot messages', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, allowedUserIds: [] }));
  await handlers.onMessage({
    message: {
      channel: 'D1',
      channel_type: 'im',
      bot_id: 'B1',
      text: 'pong',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  await assert.rejects(fs.readdir(path.join(vault, '00_Inbox')));
  assert.equal(acks.length, 0);
  await fs.rm(vault, { recursive: true, force: true });
});

test('app_mention handler strips leading mention, captures, tags, and acks', async () => {
  const vault = await tmpVault();
  const acks = [];
  const handlers = buildHandlers(makeBuilder({ vaultPath: vault, allowedUserIds: [] }));
  await handlers.onAppMention({
    event: {
      channel: 'C1',
      user: 'U1',
      text: '<@UBOT> idea: pose detection',
      ts: '1746000000.000000',
    },
    client: { chat: { postMessage: async (a) => { acks.push(a); } } },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  });
  const files = await fs.readdir(path.join(vault, '00_Inbox'));
  assert.equal(files.length, 1);
  const contents = await fs.readFile(path.join(vault, '00_Inbox', files[0]), 'utf8');
  assert.match(contents, /idea: pose detection/);
  assert.doesNotMatch(contents, /<@UBOT>/);
  assert.equal(acks.length, 1);
  await fs.rm(vault, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests, expect failures (the new tests fail until adapter is rewired; the prior 4 also need shape updates)**

Run: `cd services/brain && npm test`
Expected: failures in `slack-adapter.test.js`.

- [ ] **Step 3: Update `services/brain/src/slack/adapter.js`**

Replace the file:

```js
const path = require('node:path');
const { App } = require('@slack/bolt');
const { writeCapture } = require('../capture/writeInbox');
const { writeNote } = require('../tools/writeNote');
const { ack } = require('./reply');
const { classifyMessage } = require('../agent/classify');
const { tagCapture } = require('../agent/tag');
const { scanEntities: realScanEntities } = require('../util/entities');
const { buildClient } = require('../agent/anthropic');

/**
 * Build the per-event handler functions in isolation so they can be unit-tested
 * without booting Bolt or hitting Anthropic.
 *
 * @param {object} deps
 * @param {string} deps.vaultPath
 * @param {string[]} deps.allowedUserIds
 * @param {{client: object, model: string}} deps.anthropic
 * @param {(vault: string) => Promise<{flat: string[]}>} deps.scanEntities
 */
function buildHandlers(deps) {
  const { vaultPath, allowedUserIds, anthropic, scanEntities } = deps;

  const isAllowed = (userId) => {
    if (!userId) return false;
    if (allowedUserIds.length === 0) return true;
    return allowedUserIds.includes(userId);
  };

  async function processCapture({ text, userId, ts, channelType, channelId, threadTs, slackClient, logger }) {
    const filePath = await writeCapture({
      vaultPath,
      text,
      userId,
      ts,
      channelType,
      channelId,
    });
    logger.info?.(`capture written: ${filePath}`);

    let tags = null;
    try {
      const entities = await scanEntities(vaultPath);
      tags = await tagCapture({
        client: anthropic.client,
        model: anthropic.model,
        text,
        entities,
      });
    } catch (err) {
      logger.warn?.(`tag pass failed: ${err.message}`);
    }

    if (tags) {
      const relPath = path.relative(vaultPath, filePath);
      await writeNote({
        vaultPath,
        relPath,
        frontmatter: {
          type: tags.type,
          tags: tags.tags,
          mentions: tags.mentions,
          summary: tags.summary,
          suggested_para: tags.suggested_para,
        },
        body: `${text.trim()}\n`,
        overwrite: true,
      });
      await ack(slackClient, {
        channel: channelId,
        threadTs,
        text: formatTagAck(tags),
      });
    } else {
      await ack(slackClient, {
        channel: channelId,
        threadTs,
        text: '✓ Saved (tagging unavailable)',
      });
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
      const verdict = await classifyMessage({ text });
      // Slice 2 always returns 'capture'; future slices add 'question' / 'both'.
      if (verdict === 'capture' || verdict === 'both') {
        await processCapture({
          text,
          userId: message.user,
          ts: message.ts,
          channelType: 'dm',
          channelId: message.channel,
          threadTs: message.thread_ts || message.ts,
          slackClient: client,
          logger,
        });
      }
    } catch (err) {
      logger.error?.(err);
    }
  }

  async function onAppMention({ event, client, logger }) {
    try {
      if (!isAllowed(event.user)) return;
      const text = stripLeadingMentions(event.text);
      if (!text) return;
      const verdict = await classifyMessage({ text });
      if (verdict === 'capture' || verdict === 'both') {
        await processCapture({
          text,
          userId: event.user,
          ts: event.ts,
          channelType: 'channel',
          channelId: event.channel,
          threadTs: event.thread_ts || event.ts,
          slackClient: client,
          logger,
        });
      }
    } catch (err) {
      logger.error?.(err);
    }
  }

  return { onMessage, onAppMention };
}

function formatTagAck(tags) {
  const parts = [`✓ Saved as ${tags.type}`];
  if (tags.tags && tags.tags.length) {
    parts.push(`tags: ${tags.tags.join(', ')}`);
  }
  if (tags.mentions && tags.mentions.length) {
    parts.push(`linked: ${tags.mentions.join(' ')}`);
  }
  return parts.join(' · ');
}

function stripLeadingMentions(text) {
  return (text || '').replace(/<@[^>]+>\s*/g, '').trim();
}

function buildApp({ config }) {
  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
  });

  const anthropicClient = buildClient({ apiKey: config.anthropic.apiKey });

  const { onMessage, onAppMention } = buildHandlers({
    vaultPath: config.vaultPath,
    allowedUserIds: config.allowedUserIds,
    anthropic: { client: anthropicClient, model: config.anthropic.tagModel },
    scanEntities: realScanEntities,
  });

  app.message(async (args) => onMessage(args));
  app.event('app_mention', async (args) => onAppMention(args));

  return app;
}

module.exports = { buildApp, buildHandlers, stripLeadingMentions, formatTagAck };
```

- [ ] **Step 4: Run tests, expect 62/62 pass (58 prior + 4 new — wait, see Step 5)**

Run: `cd services/brain && npm test`

Note: This task replaces 4 prior slack-adapter tests with 5 updated ones, so the count math is `61 - 4 + 5 = 62`. If your count is off by one, double-check the test file.

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/slack/adapter.js services/brain/test/slack-adapter.test.js
git commit -m "brain: wire tag pass + ack into capture flow"
```

---

### Task 7: Doctor checks `ANTHROPIC_API_KEY` (TDD)

**Files:**
- Modify: `services/brain/src/cli/doctor.js`
- Modify: `services/brain/test/doctor.test.js`

Add an Anthropic check that the SDK can authenticate. Like the Slack check, it's dependency-injected for tests.

- [ ] **Step 1: Update tests**

Edit `services/brain/test/doctor.test.js`. Add `ANTHROPIC_API_KEY: 'sk-ant-test'` to every `env` object in existing tests (so they still PASS the env check), and pass `fetchAnthropicAuth: async () => ({ ok: true })` alongside `fetchSlackAuth` in every `runDoctor` call.

Then add three new tests at the end of the file:

```js
test('doctor PASSes anthropic check when ping returns ok', async () => {
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
  });
  const ant = checks.find((c) => c.name === 'anthropic');
  assert.equal(ant.ok, true);
  await fs.rm(vault, { recursive: true, force: true });
});

test('doctor FAILs anthropic check on bad auth', async () => {
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
    fetchAnthropicAuth: async () => ({ ok: false, error: 'invalid_api_key' }),
  });
  const ant = checks.find((c) => c.name === 'anthropic');
  assert.equal(ant.ok, false);
  assert.match(ant.message, /invalid_api_key/);
  await fs.rm(vault, { recursive: true, force: true });
});

test('doctor FAILs env when ANTHROPIC_API_KEY is missing', async () => {
  const vault = await tmpVault();
  const env = {
    SLACK_BOT_TOKEN: 'xoxb-x',
    SLACK_APP_TOKEN: 'xapp-x',
    SLACK_SIGNING_SECRET: 's',
    VAULT_PATH: vault,
    ANTHROPIC_API_KEY: '',
  };
  const checks = await runDoctor({
    env,
    fetchSlackAuth: async () => ({ ok: true }),
    fetchAnthropicAuth: async () => ({ ok: true }),
  });
  const env_check = checks.find((c) => c.name === 'env');
  assert.equal(env_check.ok, false);
  assert.match(env_check.message, /ANTHROPIC_API_KEY/);
  await fs.rm(vault, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests, expect FAIL (anthropic check not yet present in doctor)**

- [ ] **Step 3: Update `services/brain/src/cli/doctor.js`**

Replace the file:

```js
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const fs = require('node:fs/promises');
const path = require('node:path');
const { WebClient } = require('@slack/web-api');
const Anthropic = require('@anthropic-ai/sdk');

async function runDoctor({ env, fetchSlackAuth, fetchAnthropicAuth }) {
  const checks = [];

  const required = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET', 'VAULT_PATH', 'ANTHROPIC_API_KEY'];
  const missing = required.filter((k) => !env[k] || env[k].trim() === '');
  checks.push({
    name: 'env',
    ok: missing.length === 0,
    message: missing.length === 0 ? 'all required vars present' : `missing: ${missing.join(', ')}`,
  });

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

  let inboxOk = false;
  let inboxMsg = '';
  if (vaultOk) {
    try {
      const stat = await fs.stat(path.join(vaultPath, '00_Inbox'));
      inboxOk = stat.isDirectory();
      inboxMsg = inboxOk ? '00_Inbox/ present' : '00_Inbox/ exists but is not a directory';
    } catch {
      inboxMsg = '00_Inbox/ missing (will be created on first capture)';
      inboxOk = true;
    }
  } else {
    inboxMsg = 'skipped (vault check failed)';
  }
  checks.push({ name: 'inbox', ok: inboxOk, message: inboxMsg });

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

  let antOk = false;
  let antMsg = '';
  if (missing.includes('ANTHROPIC_API_KEY')) {
    antMsg = 'skipped (no key)';
  } else {
    try {
      const auth = await fetchAnthropicAuth(env.ANTHROPIC_API_KEY);
      if (auth.ok) {
        antOk = true;
        antMsg = 'auth ok';
      } else {
        antMsg = `auth failed: ${auth.error || 'unknown'}`;
      }
    } catch (err) {
      antMsg = `auth call threw: ${err.message}`;
    }
  }
  checks.push({ name: 'anthropic', ok: antOk, message: antMsg });

  return checks;
}

async function realFetchSlackAuth(token) {
  const client = new WebClient(token);
  return client.auth.test();
}

/**
 * Lightweight ping: ask the Anthropic API to list models. Counts as a real
 * authenticated call without consuming inference tokens.
 */
async function realFetchAnthropicAuth(apiKey) {
  try {
    const client = new Anthropic({ apiKey });
    await client.models.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function cli() {
  const checks = await runDoctor({
    env: process.env,
    fetchSlackAuth: realFetchSlackAuth,
    fetchAnthropicAuth: realFetchAnthropicAuth,
  });
  let allOk = true;
  for (const c of checks) {
    const tag = c.ok ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${c.name.padEnd(10)} ${c.message}`);
    if (!c.ok) allOk = false;
  }
  process.exit(allOk ? 0 : 1);
}

if (require.main === module) {
  cli();
}

module.exports = { runDoctor };
```

- [ ] **Step 4: Run tests, expect 65/65 pass (62 + 3)**

Run: `cd services/brain && npm test`

- [ ] **Step 5: Commit**

```bash
git add services/brain/src/cli/doctor.js services/brain/test/doctor.test.js
git commit -m "brain: doctor checks anthropic auth"
```

---

### Task 8: Update README + CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

Document the new env var and the tagging behavior so a fresh clone can set up Slice 2 with no surprises.

- [ ] **Step 1: README — add `ANTHROPIC_API_KEY` to env list, mention tag pass**

In `/Users/jameshu8/Desktop/2nd Brain/README.md`, find the env block (under "Configure environment") and replace:

```ini
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
VAULT_PATH=/absolute/path/to/this/repo/vault
ALLOWED_SLACK_USER_IDS=U12345    # your Slack user ID; restricts the bot to only you
```

with:

```ini
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
VAULT_PATH=/absolute/path/to/this/repo/vault
ANTHROPIC_API_KEY=sk-ant-...      # https://console.anthropic.com/settings/keys
ALLOWED_SLACK_USER_IDS=U12345     # your Slack user ID; restricts the bot to only you
```

Find the "What it does today" section. Update the description to reflect tagging:

Replace the body of "What it does today" with:

```markdown
DM the Slack bot or `@mention` it in a channel → a timestamped markdown file
appears under `vault/00_Inbox/` with frontmatter, and the bot replies with a
one-line ack like `✓ Saved as idea · tags: pose-estimation · linked: [[FormLab AI]]`.

\`\`\`yaml
---
created: 2026-04-29T01:30:00.000Z
source: slack
channel_type: dm
status: inbox
slack_user: U12345
slack_channel: D67890
type: idea
tags: [pose-estimation]
mentions: ["[[FormLab AI]]"]
summary: Idea about rep-counting via pose estimation.
suggested_para: 01_Projects/FormLab AI
---

your message text
\`\`\`

Tags are produced by Claude Haiku 4.5 with structured output (tool use).
The `mentions` field only references entities that already exist in your
vault (`05_People/`, `06_Entities/`, top-level dirs of `01_Projects/` and
`02_Areas/`); the model can't invent new wikilinks. `suggested_para` is
advisory — the file stays in `00_Inbox/` until the daily batch routes it
(Slice 6).

If the tag pass fails (rate limit, network, etc.), the file is still saved
with base frontmatter and the ack reads `✓ Saved (tagging unavailable)`.
```

Find the privacy posture section. Replace:

```markdown
- v1 does not call any LLM — your notes stay local.
- Future slices will send vault snippets to the Anthropic API for chat/tagging; this will be opt-in via `ANTHROPIC_API_KEY`. See [`docs/privacy-audit-checklist.md`](docs/privacy-audit-checklist.md) before sharing this repo.
```

with:

```markdown
- Your message text is sent to the Anthropic API for tagging (Haiku 4.5).
  The vault entity list is also sent so the model can pick from real names.
  No vault file content beyond the message you just sent is included in
  the tag pass. See [`docs/privacy-audit-checklist.md`](docs/privacy-audit-checklist.md) before sharing this repo.
```

- [ ] **Step 2: CLAUDE.md — document new frontmatter fields**

In `/Users/jameshu8/Desktop/2nd Brain/CLAUDE.md`, find the "Frontmatter conventions" section. Replace:

```markdown
## Frontmatter conventions (typical)

- `created` — ISO time
- `source` — e.g. `slack`, `manual`
- `status` — e.g. `inbox`, `active`, `archived`
- `channel_type` — for Slack: `dm` or `channel`
```

with:

```markdown
## Frontmatter conventions (typical)

Base (always present on Slack captures):
- `created` — ISO time (UTC)
- `source` — e.g. `slack`, `manual`
- `status` — `inbox`, `active`, `archived`
- `channel_type` — for Slack: `dm` or `channel`
- `slack_user`, `slack_channel`

Added by capture-time tag pass (Slice 2):
- `type` — `idea | task | note | decision | question`
- `tags` — short lowercase hyphen-separated topics
- `mentions` — wikilinks to existing vault entities only
- `summary` — single-sentence paraphrase
- `suggested_para` — advisory PARA destination (e.g. `01_Projects/FormLab AI`)

A capture without the tag fields means the tag pass failed at capture time
and the file is awaiting re-tag by the daily batch (Slice 6+).
```

- [ ] **Step 3: Sanity-check**

```bash
grep -n ANTHROPIC_API_KEY README.md
grep -n suggested_para CLAUDE.md
```

Both should produce hits.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document tag pass + ANTHROPIC_API_KEY in README and CLAUDE.md"
```

---

### Task 9: Manual end-to-end smoke (USER)

This task is not run by an automated worker — it requires a real Slack workspace, a real Anthropic key, and a real Mac. The plan execution should pause here and present the checklist to the human.

**Files:** none changed.

- [ ] **Step 1: Add the key**

Edit `services/brain/.env` and add:

```
ANTHROPIC_API_KEY=sk-ant-...
```

(Get one at https://console.anthropic.com/settings/keys.)

- [ ] **Step 2: Re-run doctor**

```bash
npm run brain:doctor
```

Expected: 5 checks, all `[PASS]` (env, vault, inbox, slack, anthropic).

- [ ] **Step 3: Restart the brain**

If the Slice 1 LaunchAgent is loaded:

```bash
launchctl kickstart -k gui/$(id -u)/com.secondbrain.brain
```

Else:

```bash
npm run brain:start
```

- [ ] **Step 4: Smoke a tagged capture**

DM the bot: `idea: rep counter via pose estimation for FormLab`.

Within ~2-3 seconds you should see a threaded ack like:

> `✓ Saved as idea · tags: pose-estimation · linked: [[FormLab AI]]`

Verify the file:

```bash
ls -lt vault/00_Inbox/ | head -3
cat "$(ls -t vault/00_Inbox/*.md | head -1)"
```

The frontmatter should include `type: idea`, `tags`, `mentions`, `summary`, `suggested_para` — *plus* the original base frontmatter.

- [ ] **Step 5: Smoke the failure path**

Temporarily set an invalid key in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-invalid
```

Restart the brain. DM "fragment thought".

Expected: file lands with base frontmatter only. Slack ack reads `✓ Saved (tagging unavailable)`.

Restore the real key, restart again.

- [ ] **Step 6: Smoke an `@mention`**

In a channel the bot is in, post `@brain note: SAFE structure questions for Acme`.

Expected: file lands with `channel_type: channel`, tagged frontmatter, threaded ack.

- [ ] **Step 7: Tail logs if anything's off**

```bash
tail -f ~/Library/Logs/secondbrain/brain.log
```

You should see `[INFO] capture written: ...` and (on success) no warnings.

---

## Self-review (filled in by plan author)

**Spec coverage** (vs. spec section "Capture path"):

- Lightweight tag pass via Haiku → Tasks 3, 4 ✓
- Returns `{ type, tags, mentions, suggested_para, summary }` → Task 4 ✓
- Mentions filtered to existing entities only → Task 4 ✓ (rejects invented entities)
- Frontmatter merge preserves base fields → Task 6 (uses writeNote with overwrite=true; merge from Slice 1) ✓
- Slack ack one-liner with tag info → Task 6 (`formatTagAck`) ✓
- Tag failure → file saved with base frontmatter, ack reads "Saved (tagging unavailable)" → Task 6 ✓
- Cached entity list refreshed hourly → Task 2 ✓
- Classifier returning `capture` (Slice 2 stub) → Task 5 ✓
- ANTHROPIC_API_KEY plumbed through env + doctor → Tasks 1, 7 ✓

**Placeholder scan:** none.

**Type/name consistency:**
- `tagCapture({ client, model, text, entities })` consistent across Tasks 4, 6.
- `classifyMessage({ text })` returning string consistent across Tasks 5, 6.
- `scanEntities(vaultPath)` returning `{ projects, areas, people, entities, flat }` consistent across Tasks 2, 4, 6.
- `buildClient({ apiKey })` consistent across Tasks 3, 6.
- `runDoctor({ env, fetchSlackAuth, fetchAnthropicAuth })` consistent in Task 7.
- `cfg.anthropic.{apiKey, tagModel, chatModel}` consistent across Tasks 1, 6.
- `formatTagAck(tags)` produces strings tested by `slack-adapter.test.js` regex assertions.

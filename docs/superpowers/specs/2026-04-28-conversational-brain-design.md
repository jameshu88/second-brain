# Conversational Brain — Design

**Status:** Draft (2026-04-28)
**Supersedes:** Capture-only ingest defined in `2026-04-28-second-brain-design.md` (that design remains valid for the capture path; this spec extends it).

## Summary

Extend the existing local-first PARA vault from a capture-only Slack pipeline into a **conversational personal-knowledge agent**. A single Slack DM thread is both the capture surface and the chat surface. The agent classifies each incoming message, writes captures to `vault/00_Inbox/` with light auto-tagging, answers questions by tool-using over the vault and Google Calendar, and runs a daily batch that routes Inbox items into PARA and extracts tasks. A first-class **status synthesis** layer answers "where am I at? / what's stale? / what should I do today?" by reading markdown directly — no separate task database.

The service runs locally on the user's Mac as a LaunchAgent-managed Node process, talks to Slack via Socket Mode (no public URL, no ngrok), and uses Anthropic Claude (Sonnet 4.6 for chat, Haiku 4.5 for cheap tagging/classification).

## Goals

- One low-friction surface (Slack DM) for both capture and conversation.
- Auto-index captures: cheap tag pass on arrival, route + extract in a daily batch.
- Status questions answered against the vault: open loops, stale projects, today's plan, catch-up.
- Read + create Google Calendar events from chat, gated by an explicit confirm step.
- Vault stays local; markdown is the only source of truth; no parallel database.
- Modular monolith: tools are pure functions, portable to MCP later.

## Non-goals (v1)

- Cloud hosting / always-on availability when the Mac is off.
- iMessage or SMS surfaces.
- Voice (TTS/STT). Text only.
- Auto-syncing calendar events into vault notes (proposals only, gated by user confirm).
- Local-only LLM. v1 uses Anthropic API; vault snippets cross the wire.
- Replacing Obsidian Tasks plugin or building a custom task UI.

## Architectural decisions

| Decision | Choice | Rationale |
|---|---|---|
| Surface | Single Slack DM thread for capture + chat | "Low friction"; existing infra; thread = conversation memory |
| Capture/question disambiguation | LLM classifier per message (Haiku) | No prefixes; mistakes correctable in one follow-up |
| Auto-indexing | Hybrid: cheap tag at capture, route+extract in daily batch | Instant feedback without files moving under the user; review before commit |
| Calendar | Google Calendar, read + create | User pick |
| LLM | Anthropic API direct (Claude 4.x) | Cleanest fit; tool-use mature; prompt caching keeps cost tractable |
| Service shape | Modular monolith in `services/brain/` | Personal-tool ergonomics; ports to MCP later via pure-function tools |
| Slack transport | Socket Mode (replace HTTP+ngrok) | No public URL; Slack queues events during brief downtime |
| Hosting | macOS LaunchAgent on user's Mac | Vault is local; agent must reach the filesystem |
| Task format | Obsidian Tasks plugin syntax | De facto standard, greppable, renders if plugin installed |
| Status data | On-demand ripgrep sweep, 60s in-process cache | Vault is small (<10k files); avoids dual source of truth |
| Write confirmation | All external-state changes (calendar create, file moves from chat) propose-then-confirm-with-`y` | Prevents prompt-injection blast radius; trust ratchet |
| Privacy | Vault snippets and calendar metadata go to Anthropic in chat. Local FS-only writes. | User-approved tradeoff |

## Module layout

Replace `services/slack-ingest/` with `services/brain/`:

```
services/brain/
  src/
    index.js                    # bootstrap: load env, start Slack adapter, register cron
    config.js                   # resolve VAULT_PATH, ANTHROPIC_API_KEY, etc.
    slack/
      adapter.js                # Bolt setup (Socket Mode); only Slack entry/exit
      reply.js                  # post message / typing indicator helpers
    agent/
      classify.js               # Haiku call: capture | question | both
      chat.js                   # Sonnet tool loop (handles question path)
      tag.js                    # Haiku call: lightweight tagging on capture
      prompts/                  # versioned system prompts (text files)
    tools/                      # pure functions; each is also a Claude tool definition
      searchVault.js            # ripgrep wrapper, returns hits w/ frontmatter
      readNote.js               # path -> content + parsed frontmatter
      writeNote.js              # safe write (capture, batch, calendar sync)
      listEvents.js             # Google Calendar read
      createEvent.js            # Google Calendar write
      synthesizeStatus.js       # the status snapshot tool
    capture/
      writeInbox.js             # lifted in from existing slack-ingest
    batch/
      dailyTriage.js            # route Inbox -> PARA, extract tasks, post digest
      cron.js                   # node-cron wiring
    google/
      auth.js                   # OAuth token load/refresh via googleapis SDK
    util/
      frontmatter.js            # parse + merge + serialize YAML frontmatter
      paths.js                  # safeJoin, vault-relative helpers
  test/                         # unit + integration tests (Vitest or node:test)
    fixtures/vault/             # shrunken PARA tree with synthetic notes
  package.json
  .env.example
  README.md
```

**Boundary contract:**

- `slack/` knows only Slack; hands `{ userId, text, threadTs, channelId }` to `agent/`.
- `agent/` knows only tool definitions; never touches `fs` or Calendar API directly.
- `tools/` are pure (filesystem in, structured JSON out); usable from chat, batch, or CLI.
- `batch/` and chat share the same `tools/` — one place to fix a bug.

## Capture path

When `agent/classify.js` returns `capture` or `both`:

1. **Write file.** `capture/writeInbox.js` — same as today's `slack-ingest`: `vault/00_Inbox/YYYY-MM-DD HHmmss - slack.md` with base frontmatter (`created`, `source: slack`, `status: inbox`, `slack_user`, `slack_channel`, `channel_type`).
2. **Light tag pass.** `agent/tag.js` calls Haiku 4.5 with the message text + cached entity list (names from `05_People/`, `06_Entities/`, top-level dirs of `01_Projects/` and `02_Areas/`). Returns:
   ```
   { type: "idea"|"task"|"note"|"decision"|"question",
     tags: [...],
     mentions: ["[[FormLab AI]]", ...],     # only existing entities
     suggested_para: "01_Projects/FormLab AI",  # advisory; not acted on
     summary: "..." }
   ```
3. **Merge frontmatter.** `util/frontmatter.js` parses, adds tag-pass fields, preserves all unknown fields.
4. **Slack ack.** Single threaded one-liner:
   > `✓ Saved as idea · tags: pose-estimation, formlab · linked: [[FormLab AI]]`
5. If classifier returned `both`, the question path runs after the capture is durable, replying further down the same thread.

**Failure modes:**

- Tag pass fails -> file saved with base frontmatter; ack reads "Saved (tagging unavailable)". Re-tagged on next daily batch.
- Slack ack fails -> log only; note is still on disk.

**Cost shape:** Haiku per capture is sub-cent at personal volume. Entity list is prompt-cached; refreshed hourly.

## Question path (chat)

When classifier returns `question` (or after capture finishes for `both`):

- **Model:** Claude Sonnet 4.6.
- **Memory:** Slack thread = session. Hydrate by reading thread via `conversations.replies` (last N=20). New top-level DM = fresh conversation. No external session store.
- **Tool loop:** Standard Anthropic tool-use loop. Tools:

| Tool | Purpose |
|---|---|
| `search_vault({ query, frontmatter_filter? })` | ripgrep substring + frontmatter; returns `[{ path, line, snippet, frontmatter }]` |
| `read_note({ path })` | full file by vault-relative path; path-traversal guarded |
| `list_events({ from?, to?, calendar_id?, q? })` | Google Calendar read |
| `create_event({ title, start, end, ... })` | Google Calendar write; **gated by write-confirm** |
| `synthesize_status({ scope? })` | structured status snapshot (see below) |

- **Write-confirm gate.** No tool that mutates external state auto-fires from chat. Agent proposes; user replies `y`/`yes`. State held in `services/brain/.state/threads.json` keyed by `thread_ts`, expiring after 10 minutes. Hard rule baked into the system prompt.
- **System prompt** (lives in `agent/prompts/chat.md`, versioned):
  - Personal-knowledge agent over PARA vault + Google Calendar.
  - Search vault before answering from training data.
  - Tight replies; user reads on phone.
  - Never invent paths or events. Empty results -> say so.
  - For status questions ("what's open?", "where am I at?"), call `synthesize_status` first.
- **Streaming:** none. Slack reply posted once after tool loop completes. Latency budget 3-8s typical.
- **Caching:** prompt-cache the system prompt + tool definitions + entity list to keep follow-ups cheap.

## Status synthesis

The marquee feature. One tool, `synthesize_status`, returns a structured snapshot the chat agent narrates per question.

```js
synthesize_status({ scope?: "all" | "today" | "open_loops" | "stale" })
  -> {
       open_tasks:        [{ path, line, text, due, priority, project }],
       active_projects:   [{ name, last_modified, recent_files: [...] }],
       inbox_pending:     [{ path, age_days, type, summary, mentions }],
       stale_projects:    [{ name, days_since_touch, last_file }],
       decisions_pending: [{ path, opened, question }],
       today_calendar:    [{ time, title, related_notes: [...] }],
       week_calendar:     [...],
       generated_at:      "ISO 8601"
     }
```

**Field derivations:**

| Field | How |
|---|---|
| `open_tasks` | `rg '^- \[ \]' vault/`, parse `📅`/`⏫`/`#project/...`/wikilinks |
| `active_projects` | Subdirs of `01_Projects/` with mtime within `STALE_PROJECT_DAYS` (default 14) |
| `inbox_pending` | Files in `00_Inbox/`, age = now - `created` frontmatter |
| `stale_projects` | Subdirs of `01_Projects/` and `02_Areas/` whose deepest file mtime exceeds `STALE_PROJECT_DAYS` |
| `decisions_pending` | `rg 'type: decision'` filtered to files lacking `decided:` frontmatter |
| `today_calendar` | `list_events` for today; titles fuzzy-matched against entity names for `related_notes` |
| `week_calendar` | Same, scoped to next 7 days |

**Cross-referencing rule for `related_notes`:** case-insensitive token overlap of event title + attendee emails against entity names from `05_People/*.md`, `06_Entities/*.md`, subdirs of `01_Projects/`. Optional alias map at `08_Templates/aliases.md` — a markdown file with one alias group per line: `Canonical = alias1, alias2`. Never invents notes — empty `related_notes` is fine.

**Question routing** (agent decides via system prompt):

| Question | Tool call | Narration emphasis |
|---|---|---|
| "where am I at?" | `synthesize_status({scope:"all"})` | active_projects + today_calendar; 5-line summary |
| "catch me up" | same + recent-modified scan | what changed in last `RECENT_CHANGE_DAYS` (default 3) |
| "open loops?" | `synthesize_status({scope:"open_loops"})` | open_tasks (no `✅`) + decisions_pending |
| "what should I do today?" | `synthesize_status({scope:"today"})` | today_calendar interleaved with tasks `📅 today` and high-priority overdue |
| "what's stale?" | `synthesize_status({scope:"stale"})` | stale_projects + inbox_pending older than `STALE_INBOX_DAYS` (7) |

**Performance:** ~50ms on a personal vault. In-process 60s cache keyed by scope; invalidated on batch completion.

**CLI access:** `npm run brain:status` calls the same function and prints the snapshot. Useful for debugging and Monday-digest piping.

## Daily batch

Runs at `DAILY_BATCH_CRON` (default `0 7 * * *` local) via `node-cron` in-process. Three idempotent passes:

**Pass A — Route Inbox to PARA.** For each file in `00_Inbox/`:

1. Read file + frontmatter.
2. Skip if `created` is within the last 6 hours.
3. Sonnet call: text + existing PARA destinations + `suggested_para` -> `{ destination, confidence, reason }`.
4. If `confidence ≥ 0.7`: `fs.rename` to destination; stamp `routed: <ts>` + `routed_to: <path>`.
5. Else: leave in Inbox; add `triage_note: <reason>`.
6. **Never auto-create new project folders.** Best-fit-is-new-project -> leave in Inbox with `suggested_para: 01_Projects/<NewName>`.

**Pass B — Extract tasks.** For each file routed (or edited) in last `RECENT_CHANGE_DAYS`:

1. Sonnet call: "actionable items?" -> `[{ text, due?, priority?, project_link? }]`.
2. Append new tasks (deduped by text hash) to today's `07_Daily/YYYY-MM-DD.md` under `## Tasks` heading, in Obsidian Tasks syntax with `⛺ [[source-link]]`.
3. Stamp `tasks_extracted: true` on source.
4. **Additive only.** Tasks closed by checking the box; batch never removes.

**Pass C — Status digest.** Calls `synthesize_status({scope:"all"})`. Posts a fresh DM (not in any thread):

> **Daily digest 2026-04-29**
> Filed 4 captures · extracted 3 tasks · 2 stale projects
> Today: 3 events, 5 open tasks
> Reply `status` for the full snapshot.

Suppressed via existing self-`bot_id` check so it doesn't trigger the classifier.

**Failure handling:**

- Pass A failure on one file -> log + continue. Untouched files picked up next run.
- Pass B is additive -> safe to re-run.
- Pass C failure -> log only; not retried.

**Manual trigger:** `npm run brain:triage` (same code path).
**Dry run:** `npm run brain:triage -- --dry-run` prints proposed moves and extractions; no fs or Slack writes.

## Calendar integration

**Auth.** One-time `npm run brain:google-auth`:

1. Local OAuth callback server on a random port.
2. Print consent URL; user approves in browser.
3. Refresh token -> `~/.config/secondbrain/google-token.json` (chmod 600). **Outside repo.**
4. Scopes: `calendar.events`, `calendar.readonly`.

User sets up Google Cloud OAuth client once; pastes `id`/`secret` into `.env`. README walks through it. Refresh handled by `googleapis` SDK. Revoked-token failure surfaces in Slack: "Run `npm run brain:google-auth`."

**Tools:**

```
list_events({ from?, to?, calendar_id?, q? })
  -> [{ id, title, start, end, attendees, location, description, calendar }]
create_event({ title, start, end, description?, location?, attendees?, calendar_id? })
  -> { id, htmlLink }
```

Defaults: `from=now`, `to=now+7d`, `calendar_id=primary`. Multi-calendar via `DEFAULT_CALENDAR_IDS=primary,work@example.com`.

**Time zones.** Service detects host TZ via `Intl.DateTimeFormat().resolvedOptions().timeZone`. Natural-language times parsed in user's local TZ; Google gets RFC3339 with offset. Vault frontmatter timestamps stay UTC.

**Write-confirm flow:**

> *User:* "block 2 hours Thursday for FormLab pitch"
> *Agent:* "Propose: 'FormLab pitch prep' Thu May 1, 14:00-16:00 PT, no attendees. Reply `y` to create."
> *User:* "y"
> *Agent:* "Created. <link>"

Pending action lives in `.state/threads.json[thread_ts]`, 10-minute expiry.

**No auto-sync into vault.** Agent may *propose* meeting-prep notes; goes through same write-confirm.

## Hosting & availability

**Slack transport: Socket Mode.** Outbound WebSocket from the Mac. No public URL, no ngrok. Slack queues events server-side during brief downtime; replays on reconnect.

**Process: macOS LaunchAgent.** `~/Library/LaunchAgents/com.secondbrain.brain.plist`:

- starts on login,
- `KeepAlive=true` (restarts on crash),
- stdout/stderr -> `~/Library/Logs/secondbrain/brain.log` and `brain.err`.

Helpers: `scripts/install-launchd.sh`, `scripts/uninstall-launchd.sh`.

**Sleep behavior:**

| Mac state | Behavior |
|---|---|
| Awake, service up | Captured/answered in seconds |
| Asleep / Wi-Fi blip | Slack queues; processes on wake (timestamps preserved) |
| Off / no Slack queue | Message visible in Slack scrollback; resend when back |

**Doctor command:** `npm run brain:doctor` checks Slack auth, Anthropic key, Google token, vault path RW, `last_run.json` freshness. Prints PASS/FAIL per check.

## Storage conventions

**Frontmatter schema (extends existing):**

```yaml
---
created: 2026-04-29T14:32:01.000Z   # UTC ISO 8601
source: slack                        # slack | manual | calendar
status: inbox                        # inbox | active | archived
slack_user: U12345
slack_channel: D67890
channel_type: dm

# Capture-time tag pass:
type: idea                           # idea | task | note | decision | question
tags: [pose-estimation, formlab]
mentions: ["[[FormLab AI]]"]
suggested_para: 01_Projects/FormLab AI

# Daily-batch routing:
routed: 2026-04-30T07:00:00.000Z
routed_to: 01_Projects/FormLab AI/idea-rep-counter.md

# Daily-batch extraction:
tasks_extracted: true

# Decision lifecycle:
decided: 2026-05-02T10:00:00.000Z
decision: "Use MediaPipe over OpenPose"
---
```

Required: `created`, `source`, `status`. All others optional. Unknown fields preserved through edits.

**Tasks format** — Obsidian Tasks plugin syntax:

```
- [ ] Draft FormLab pitch deck 📅 2026-05-02 ⏫ #project/formlab ⛺ [[01_Projects/FormLab AI/idea-rep-counter]]
```

`⛺` = source link convention. Tasks plugin not required for the agent to work; it just renders nicer if installed.

**State files (gitignored):**

```
~/.config/secondbrain/
  google-token.json           # OAuth refresh token, chmod 600
  google-client.json          # optional: OAuth client id/secret if not in .env

services/brain/.state/
  threads.json                # { [thread_ts]: { pendingAction, expiresAt } }
  last_run.json               # { lastBatchAt, lastDigestAt }
  entity_cache.json           # vault entity list, refreshed hourly

~/Library/Logs/secondbrain/
  brain.log
  brain.err
```

**Vault-write invariants:**

1. **Path safety.** Every write goes through `util/paths.js#safeJoin(vaultPath, rel)` which rejects `..`, absolute paths, and any escape from the vault root.
2. **Atomic writes.** Write to `<path>.tmp`, then `fs.rename`. Obsidian never sees a half-written file.
3. **No silent overwrite.** `writeNote({ overwrite: false })` is the default. Capture dedupes by suffix; routing collision-checks and appends `(2)`.
4. **Frontmatter merge, not replace.** Parse, merge, preserve unknowns, re-serialize with stable key order.

**Configuration (`.env`):**

```
ANTHROPIC_API_KEY=
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=                     # Socket Mode
SLACK_SIGNING_SECRET=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
VAULT_PATH=/Users/jameshu8/Desktop/2nd Brain/vault
ALLOWED_SLACK_USER_IDS=U12345
DEFAULT_CALENDAR_IDS=primary
TIMEZONE=                            # blank = auto-detect
STALE_PROJECT_DAYS=14
STALE_INBOX_DAYS=7
RECENT_CHANGE_DAYS=3
DAILY_BATCH_CRON=0 7 * * *
DAILY_DIGEST=on
DRY_RUN=off                          # batch-only; capture writes are never dry-runned
LOG_LEVEL=info
```

## Errors, observability, testing

**Error policy:**

| Class | Response |
|---|---|
| Capture failure (fs write, frontmatter parse) | Log + DM: "⚠️ Capture failed: <reason>. Original message preserved in Slack." Never lose data silently. |
| Tag/classify failure (Anthropic 5xx, rate limit) | Save with base frontmatter; ack "Saved (tagging unavailable)"; re-tagged in next daily batch. |
| Chat tool failure (calendar 401, empty search, etc.) | Surface to agent; agent reports the failure plainly. **Never invent results.** |

**Hard rule:** the chat agent never silently fakes a tool result. Empty `search_vault` -> "no matches in your vault."

**Observability:**

- Single structured log line per request path: `{ ts, level, event, threadTs?, latencyMs?, tokens?, cost?, ...ctx }`.
- LaunchAgent stdout/stderr -> `~/Library/Logs/secondbrain/brain.log`. Daily rotation with size cap.
- Cost tracking: each Anthropic call logs `{ input_tokens, output_tokens, cache_read, cache_write, model, cost_usd }`. Weekly summary in `services/brain/.state/cost.log`. Optional digest line: "Cost this week: $0.34."
- `npm run brain:doctor` for fast sanity checks (Section "Hosting & availability").

**Testing strategy:**

- **Unit (Vitest or `node:test`):**
  - `util/frontmatter.js` — parse/merge/serialize roundtrip with messy inputs.
  - `util/paths.js#safeJoin` — fuzzed against `..`, `~`, encoded traversal.
  - Each `tools/*` — mock `fs` and `googleapis`, assert input/output contracts.
  - `synthesizeStatus` — golden test against frozen `test/fixtures/vault/`.
- **Integration:**
  - Capture: simulated Slack DM -> file appears with correct frontmatter and tagging.
  - Batch: fixture inbox -> `dailyTriage` -> assert routes, tasks, no Inbox leftovers above threshold.
- **No tests for Slack adapter or LaunchAgent plist generation** — covered by `brain:doctor` and manual smoke.
- **Test data:** `services/brain/test/fixtures/vault/` — shrunken PARA tree with synthetic notes covering each `type` and one stale project. Committed; never references real entities.

**Manual smoke checklist (in README):**

1. `npm run dev` -> service starts, `brain:doctor` PASSes.
2. DM "test capture" -> file in `00_Inbox/` with frontmatter + tag.
3. DM "what's on my calendar today?" -> events.
4. DM "block 30 min tomorrow for testing" -> proposal -> `y` -> event created.
5. `npm run brain:triage -- --dry-run` -> proposed routes/extractions, no fs change.

## Phasing

This spec implements as one design but ships in slices, each leaving the system runnable:

1. **Slice 1 — Foundation.** Move `slack-ingest` to `services/brain/`, switch to Socket Mode, add LaunchAgent installer, add `brain:doctor`. Capture works as today.
2. **Slice 2 — Capture-time tagging.** Add `agent/classify.js` (still always-capture for now) and `agent/tag.js` light-tag pass. Slack ack one-liner.
3. **Slice 3 — Question path.** Add `agent/chat.js`, `tools/searchVault.js`, `tools/readNote.js`. Classifier flips to `capture | question | both`. No calendar yet.
4. **Slice 4 — Status synthesis.** Add `tools/synthesizeStatus.js` + CLI. Wire it into the chat tool loop.
5. **Slice 5 — Calendar.** Google OAuth + `list_events` + `create_event` (with write-confirm).
6. **Slice 6 — Daily batch.** Routing, task extraction, digest. Dry-run flag from day one.

Each slice is testable end-to-end; merging order matters but each is independent enough that a slice can be reverted without breaking earlier ones.

## Open questions to revisit

These don't block v1 but warrant a note:

- **Multiple Slack workspaces.** v1 supports one. If user joins a second, design reconsidered.
- **Vault entity refresh cadence.** Hourly may stale-out for new projects created mid-day. Could subscribe to `fs.watch` on top-level dirs if it becomes a problem.
- **Calendar write of recurring events.** `create_event` v1 does single events only; recurring event creation needs `recurrence` field plumbing.
- **Task completion reflection.** Closing a task in Obsidian doesn't notify the agent. v1 ok — checkbox state read at synthesis time. If we ever want "you closed X today, nice", need a watcher.
- **MCP migration.** Tools are pure for a reason. Phase 2 wraps `tools/` in an MCP server so Claude Desktop / future iMessage adapter reuse the same surface.

# Second Brain (PARA + Obsidian + Slack) Implementation Plan

> **For agentic workers:** Use `docs/superpowers/specs/2026-04-28-second-brain-design.md` as the source of truth.

**Goal:** Ship a git-safe scaffold (`vault.example/`), Slack ingest service, and docs so the user can copy the vault locally and connect Slack without committing secrets or notes.

**Architecture:** Node `@slack/bolt` HTTP app verifies Slack signatures and writes one markdown file per message under `{VAULT_PATH}/0 Inbox/`. `vault/` stays gitignored.

**Tech Stack:** Node.js, `@slack/bolt`, Obsidian (user-installed), Dataview (community plugin).

---

### Task 1: Repository hygiene

**Files:**
- Create: `.gitignore`
- Create: `README.md`

- [ ] Ignore `vault/`, `.env`, `.env.*`, common OS junk, `node_modules/`
- [ ] README: clone setup, copy `vault.example` → `vault`, Slack env vars, run ingest

### Task 2: Vault example scaffold

**Files:**
- Create: `vault.example/0 Inbox/.gitkeep`, `vault.example/1 Projects/...`, etc.
- Create: `vault.example/_Dashboard.md` (Dataview)
- Create: `vault.example/0 Inbox/.sample-capture.md` (fictional sample)

- [ ] PARA folders 0–4 and `_Dashboard.md` with Dataview queries
- [ ] Sample note with documented frontmatter

### Task 3: Slack ingest service

**Files:**
- Create: `services/slack-ingest/package.json`
- Create: `services/slack-ingest/src/index.js`
- Create: `services/slack-ingest/src/writeInbox.js`
- Create: `services/slack-ingest/.env.example`
- Create: `services/slack-ingest/README.md`

- [ ] Start Bolt app on `PORT` (default 3000)
- [ ] Handle `app_mention` and DM `message` (ignore bot subtypes)
- [ ] Optional `ALLOWED_SLACK_USER_IDS` guard
- [ ] Write UTF-8 markdown with YAML frontmatter

### Task 4: Agent and audit docs

**Files:**
- Create: `CLAUDE.md`
- Create: `docs/privacy-audit-checklist.md`

- [ ] PARA map, triage rules, `rg` examples, safety rules (no exfil)
- [ ] Checklist: before sharing repo, env, backups

### Task 5: Verify

- [ ] `npm install` in `services/slack-ingest` and `node --check` on entry
- [ ] Confirm `vault/` absent from `git status` after adding test file locally (manual note in README)

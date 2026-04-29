# Second Brain (PARA + Obsidian + Slack) — Design

**Status:** Approved (2026-04-28)

## Summary

A local-first **PARA** vault for Obsidian lives in `vault/` (gitignored). The repository ships **automation, documentation, and `vault.example/`** only. Capture **v1** is a **Slack bot** that writes timestamped markdown files into `vault/0 Inbox/` with consistent YAML frontmatter. **Claude Code** and other agents use repo docs (`CLAUDE.md`) and ripgrep over `vault/`. **Visualization** is Obsidian-native (graph, **Dataview** on `_Dashboard.md`). **iMessage** may reuse the same ingest pattern later (Shortcuts → webhook).

## Goals

- PARA structure with clear triage path from Inbox → Projects / Areas / Resources / Archives.
- No private notes or secrets in git; audit-friendly layout.
- Slack as primary capture surface (DMs + optional app mentions).
- Queryability for AI: predictable paths, frontmatter, searchable plaintext markdown.

## Non-goals (v1)

- Hosting ingest on managed cloud (user runs service locally or own server).
- Full task manager replacement (calendar / Tasks plugin are optional user choices).
- iMessage automation (documented as phase 2).

## Repository layout

| Path | In git | Purpose |
|------|--------|---------|
| `vault/` | **No** | Live Obsidian vault |
| `vault.example/` | **Yes** | PARA skeleton + sample notes (no real content) |
| `services/slack-ingest/` | **Yes** | Slack Events → markdown files |
| `docs/` | **Yes** | Setup, privacy checklist |
| `.env` / `.env.local` | **No** | Tokens and optional overrides |

## PARA placement rules

- **Inbox:** All quick captures (including Slack) before triage.
- **Time-specific errands** (e.g. “flowers Tuesday”): calendar / daily note; link to Project or Area if part of a bigger outcome.
- **Deferred actions:** Project if there is a defined outcome; Area if ongoing responsibility; Inbox until clarified.
- **Projects / Areas / Resources / Archives:** Standard PARA semantics.

## Slack pipeline

- Slack app with Events API; Bolt (or equivalent) verifies **signing secret**.
- Events: **direct messages to the bot**; optional **`app_mention`** in a workspace channel.
- Each message creates **one file** under `vault/0 Inbox/` with frontmatter: `created`, `source`, `status`, `slack_user`, optional `channel_type`.
- Optional env **`ALLOWED_SLACK_USER_IDS`**: drop or reject messages from other users.

## Privacy and audits

- Secrets only via environment variables.
- `vault/` never committed; contributors clone `vault.example/` → `vault/` locally.
- Documented checklist for sharing the repo (what is and is not included).

## Visualization

- Obsidian **Dataview** tables on `_Dashboard.md` (requires Community Plugins).
- Graph view for linked notes.

## AI agents

- Root **`CLAUDE.md`**: folder map, frontmatter keys, triage rules, search hints.
- Agents search `vault/` with `rg`; no requirement for a generated index in v1.

## Future: iMessage

- Shortcuts POST to the same ingest HTTP endpoint (small adapter if payload differs).

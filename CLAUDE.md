# Second brain — agent rules

## Layout

- Live vault: `vault/` (gitignored). **Never** commit or paste its contents into public issues.
- Public shape only: `vault.example/` (PARA skeleton + samples).

PARA folders under the vault root:

- `00_Inbox/` — quick capture (Slack writes here with `source: slack`, `status: inbox`)
- `01_Projects/` — outcomes with a defined “done”
- `02_Areas/` — ongoing standards of responsibility
- `03_Resources/` — reference / topics
- `04_Archive/` — inactive

Triage: move or link notes from Inbox into the right area; use calendar / daily notes for day-specific errands.

## Frontmatter conventions (typical)

- `created` — ISO time
- `source` — e.g. `slack`, `manual`
- `status` — e.g. `inbox`, `active`, `archived`
- `channel_type` — for Slack: `dm` or `channel`

## How to search (terminal)

From repo root, search the private vault (if present):

```bash
rg -n "keyword" vault/
rg -l "status: inbox" vault/00_Inbox/
```

Respect user privacy: do not upload vault contents to external services unless the user explicitly asks.

## Slack ingest

Service: `services/slack-ingest/`. Configuration is only via environment variables; secrets are not in the repo.

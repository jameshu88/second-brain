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

A capture without the tag fields means the tag pass failed at capture time and the file is awaiting re-tag by the daily batch (Slice 6+).

## How to search (terminal)

From repo root, search the private vault (if present):

```bash
rg -n "keyword" vault/
rg -l "status: inbox" vault/00_Inbox/
```

Respect user privacy: do not upload vault contents to external services unless the user explicitly asks.

## Slack ingest

Service: `services/slack-ingest/`. Configuration is only via environment variables; secrets are not in the repo.

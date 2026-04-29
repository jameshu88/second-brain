# Second Brain

A local-first **PARA** Obsidian vault with a Slack-based capture agent that writes anything you DM it into your `00_Inbox/` as markdown notes.

This repository ships the **structure, code, and docs**. Your real notes live in `vault/`, which is gitignored — they never leave your machine.

> **Status:** Slice 1 (foundation). Capture-only today. Auto-tagging, conversational chat, status synthesis, and Google Calendar are scoped in [the design spec](docs/superpowers/specs/2026-04-28-conversational-brain-design.md) and ship in subsequent slices.

## What it does today

DM the Slack bot or `@mention` it in a channel → a timestamped markdown file appears under `vault/00_Inbox/` with frontmatter:

```yaml
---
created: 2026-04-29T01:30:00.000Z
source: slack
channel_type: dm
status: inbox
slack_user: U12345
slack_channel: D67890
---

your message text
```

Open the vault in Obsidian; the file is there immediately (no sync round-trip).

## Prerequisites

- **macOS** (LaunchAgent runs the brain in the background; the service itself is Node and would run on Linux too — only the install scripts are Mac-specific).
- **Node 18+** (`node --version`).
- **Obsidian** ([obsidian.md](https://obsidian.md/)) — open the `vault/` folder as a vault.
- **A Slack workspace** where you can create an app you control.

## Setup

### 1. Clone

```bash
git clone <this-repo-url> "Second Brain"
cd "Second Brain"
```

### 2. Create a Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.

- **Socket Mode** (left sidebar) → enable → generate an **app-level token** with the `connections:write` scope (`xapp-...`). Copy it.
- **OAuth & Permissions** → **Bot Token Scopes** → add:
  - `app_mentions:read`
  - `im:history`
  - `chat:write`
- **Event Subscriptions** → enable → **Subscribe to bot events**:
  - `app_mention`
  - `message.im`
- **Install App** to your workspace. Copy the **Bot User OAuth Token** (`xoxb-...`).
- **Basic Information** → copy the **Signing Secret**.

### 3. Configure environment

```bash
npm run dev
```

The first run copies `vault.example/` → `vault/` and `services/brain/.env.example` → `services/brain/.env`, then exits with instructions. Open `services/brain/.env` and fill in:

```ini
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
VAULT_PATH=/absolute/path/to/this/repo/vault
ALLOWED_SLACK_USER_IDS=U12345    # your Slack user ID; restricts the bot to you
```

### 4. Run

```bash
npm run dev
```

The brain runs on Slack Socket Mode — **no public URL, no ngrok needed**. DM the bot or `@mention` it in a channel and watch a file appear in `vault/00_Inbox/`.

### 5. Run as a background service (optional, recommended)

```bash
npm run launchd:install      # starts on login, restarts on crash
npm run launchd:uninstall    # to remove
```

Logs: `~/Library/Logs/secondbrain/brain.{log,err}`.

## Diagnose

```bash
npm run brain:doctor
```

Checks the env vars, vault path is readable+writable, `00_Inbox/` exists, and Slack auth works.

## Layout

```
.
├── services/brain/        # the Node service (Slack adapter, capture, frontmatter, doctor)
├── scripts/               # dev.sh, install/uninstall LaunchAgent
├── vault.example/         # public PARA skeleton (copied to vault/ on first run)
├── vault/                 # YOUR private notes (gitignored — never committed)
├── docs/
│   ├── privacy-audit-checklist.md
│   └── superpowers/
│       ├── specs/         # design specs
│       └── plans/         # implementation plans
├── CLAUDE.md              # rules for AI agents working in this repo
└── README.md
```

PARA folders inside the vault:

| Folder | Purpose |
|---|---|
| `00_Inbox/` | Quick capture from Slack |
| `01_Projects/` | Outcomes with a defined "done" |
| `02_Areas/` | Ongoing standards of responsibility |
| `03_Resources/` | Reference material, topics |
| `04_Archive/` | Inactive |
| `05_People/` | Person notes |
| `06_Entities/` | Companies, products, organizations |
| `07_Daily/` | Daily notes |
| `08_Templates/` | Note templates |
| `09_Maps_of_Content/` | High-level index/MOC notes |

## Privacy posture

- `vault/` is gitignored. Never run `git add -f vault/`.
- Slack tokens live only in `services/brain/.env` (gitignored).
- v1 does not call any LLM — your notes stay local.
- Future slices will send vault snippets to the Anthropic API for chat/tagging; this will be opt-in via `ANTHROPIC_API_KEY`. See [`docs/privacy-audit-checklist.md`](docs/privacy-audit-checklist.md) before sharing this repo.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm run dev` exits with "Edit `services/brain/.env`" | First-run is intentional — fill in the env file and re-run. |
| `brain:doctor` fails "missing: SLACK_APP_TOKEN" | You need Socket Mode enabled in Slack and an `xapp-...` token. |
| `brain:doctor` fails "vault unreachable" | `VAULT_PATH` in `.env` must be the absolute path to the `vault/` directory. |
| `brain:doctor` fails "auth failed: invalid_auth" | Re-copy the bot token (`xoxb-...`); it must be from your installed app. |
| DM sent but no file appears | Make sure your Slack user ID is in `ALLOWED_SLACK_USER_IDS`. Tail `~/Library/Logs/secondbrain/brain.log`. |

## Tests

```bash
npm run brain:test
```

43 tests across the path-safety, frontmatter, capture writer, config, Slack adapter, and doctor modules.

## Design and roadmap

- **Spec** (full design, all six slices): [`docs/superpowers/specs/2026-04-28-conversational-brain-design.md`](docs/superpowers/specs/2026-04-28-conversational-brain-design.md)
- **Slice 1 plan** (this build): [`docs/superpowers/plans/2026-04-28-brain-slice-1-foundation.md`](docs/superpowers/plans/2026-04-28-brain-slice-1-foundation.md)

Upcoming slices: capture-time auto-tagging (Haiku), conversational Q&A over the vault (Sonnet, tool use), status synthesis ("what should I do today?", "what's stale?"), Google Calendar read+create, daily auto-routing batch.

## License

This repository ships structure and code — your notes are yours. Add a license file if you plan to redistribute.

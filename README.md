# Second Brain

A local-first **PARA** Obsidian vault with a Slack-based capture agent that writes anything you DM it into your `00_Inbox/` as markdown notes.

This repository ships the **structure, code, and docs**. Your real notes live in `vault/`, which is gitignored — they never leave your machine.

> **Status:** Slice 1 (foundation). Capture-only today. Auto-tagging, conversational chat, status synthesis, and Google Calendar are scoped in [the design spec](docs/superpowers/specs/2026-04-28-conversational-brain-design.md) and ship in subsequent slices.

## What it does today

DM the Slack bot or `@mention` it in a channel → a timestamped markdown file appears under `vault/00_Inbox/` with frontmatter, and the bot replies with a one-line ack like `✓ Saved as idea · tags: pose-estimation · linked: [[FormLab AI]]`.

```yaml
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
```

Tags are produced by Claude Haiku 4.5 with structured output (tool use). The `mentions` field only references entities that already exist in your vault (`05_People/`, `06_Entities/`, top-level dirs of `01_Projects/` and `02_Areas/`); the model can't invent new wikilinks. `suggested_para` is advisory — the file stays in `00_Inbox/` until the daily batch routes it (Slice 6).

If the tag pass fails (rate limit, network, etc.), the file is still saved with base frontmatter and the ack reads `✓ Saved (tagging unavailable)`.

## Chat

You can also ask the brain things. Each Slack message is classified as `capture` (drop a thought), `question` (ask the agent), or `both`. Examples:

- `find my notes on SAFEs` → searches `vault/` and replies with hits.
- `what's on my calendar tomorrow?` → reads Google Calendar (if configured).
- `block 2 hours Thursday for FormLab pitch` → proposes the event and asks you to reply `y` to confirm. Only `y`/`yes` actually creates it.

Conversation memory is the Slack thread itself — replies in the same thread keep context; a fresh top-level DM starts a new conversation.

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
ANTHROPIC_API_KEY=sk-ant-...
ALLOWED_SLACK_USER_IDS=U12345

# Optional — enable calendar tools:
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
DEFAULT_CALENDAR_IDS=primary
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
- Your message text is sent to the Anthropic API for tagging (Haiku 4.5). The vault entity list is also sent so the model can pick from real names. No vault file content beyond the message you just sent is included in the tag pass. See [`docs/privacy-audit-checklist.md`](docs/privacy-audit-checklist.md) before sharing this repo.

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

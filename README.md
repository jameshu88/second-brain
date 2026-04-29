# Second Brain

Local-first PARA vault + conversational brain over Slack and Google Calendar.

- **Vault** lives at `vault/` (gitignored). Open in Obsidian.
- **`vault.example/`** is the public skeleton checked into git.
- **`services/brain/`** is the Node service that captures Slack messages into
  `vault/00_Inbox/` and (in later slices) classifies, answers, and routes
  notes via Anthropic Claude.

## Quick start

```bash
npm run dev
```

On first run it creates `vault/` from `vault.example/` and
`services/brain/.env` from `.env.example`. Edit the `.env`, then run again.

The brain runs in Slack **Socket Mode** — no public URL or ngrok required.
See `services/brain/README.md` for Slack setup.

## Run as a background service (macOS)

```bash
npm run launchd:install      # starts on login, restarts on crash
npm run launchd:uninstall    # remove
```

Logs: `~/Library/Logs/secondbrain/brain.{log,err}`.

## Health check

```bash
npm run brain:doctor
```

## Design

- Spec:   `docs/superpowers/specs/2026-04-28-conversational-brain-design.md`
- Slice 1 plan: `docs/superpowers/plans/2026-04-28-brain-slice-1-foundation.md`

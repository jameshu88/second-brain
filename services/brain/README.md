# brain

Conversational brain for the PARA vault. Slice 1: capture parity with the
former `slack-ingest` service, running via Slack Socket Mode under macOS
LaunchAgent.

See `docs/superpowers/specs/2026-04-28-conversational-brain-design.md` for
the design and `docs/superpowers/plans/2026-04-28-brain-slice-1-foundation.md`
for the slice plan.

## Setup (Slack)

1. Create a Slack app at https://api.slack.com/apps.
2. Enable **Socket Mode** under the Socket Mode tab and generate an
   app-level token with the `connections:write` scope (`xapp-...`).
3. Bot token scopes (OAuth & Permissions):
   - `app_mentions:read`
   - `im:history`
   - `chat:write`
4. Subscribe to bot events: `app_mention`, `message.im`.
5. Install the app to your workspace; copy the bot token (`xoxb-...`)
   and signing secret.
6. Copy `.env.example` to `.env` and fill in the three Slack values
   plus `VAULT_PATH`.

## Run

```bash
cd services/brain
npm install
npm run doctor   # sanity-check env, vault, Slack auth
npm start
```

DM the bot or @mention it in a channel; the message saves to
`$VAULT_PATH/00_Inbox/` as a markdown file with frontmatter.

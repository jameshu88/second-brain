# Privacy and audit checklist

Use this before **pushing to GitHub**, **sharing the repo**, or **onboarding** someone who should not see your notes.

## Git

- [ ] `vault/` is **not** tracked (`git status` does not list files under `vault/`).
- [ ] No `.env` or `services/slack-ingest/.env` in commits.
- [ ] No accidental `git add -f` of private paths.
- [ ] If you ever committed secrets, **rotate** Slack tokens and use `git filter-repo` or similar; assume history is compromised.

## Files in the repo

- [ ] Only `vault.example/` contains example markdown (no real personal data).
- [ ] No API keys, tokens, or private URLs in committed markdown or config.

## Slack

- [ ] Bot token and signing secret exist only in environment or a local untracked file.
- [ ] `ALLOWED_SLACK_USER_IDS` is set if the bot should be restricted to you (or a small set of users).
- [ ] Event subscription URL points to **your** tunnel or server, not a shared default.

## Backups and sync

- [ ] You know where your real `vault/` is backed up (Time Machine, encrypted drive, etc.).
- [ ] iCloud / Dropbox: understand that the cloud provider can read unencrypted vault files unless you use additional encryption (e.g. Obsidian features or OS-level encryption).

## Sharing this repository

- [ ] Remove or redact any machine-specific absolute paths in personal notes or local-only docs (use `VAULT_PATH` in private `.env` instead of hardcoding in committed files).

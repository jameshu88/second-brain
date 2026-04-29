#!/usr/bin/env bash
# One-command dev: prepare vault, install deps, run brain (Socket Mode).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export VAULT_PATH="${VAULT_PATH:-$ROOT/vault}"
BRAIN_DIR="$ROOT/services/brain"

cd "$ROOT"

echo "[dev] Repo: $ROOT"

# Vault
if [[ ! -d "$ROOT/vault" ]]; then
  echo "[dev] Creating vault from vault.example -> $ROOT/vault"
  cp -R "$ROOT/vault.example" "$ROOT/vault"
fi

# Brain .env
if [[ ! -f "$BRAIN_DIR/.env" ]]; then
  echo "[dev] Creating $BRAIN_DIR/.env from .env.example"
  cp "$BRAIN_DIR/.env.example" "$BRAIN_DIR/.env"
  echo ""
  echo "Edit $BRAIN_DIR/.env, fill in:"
  echo "  SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET, VAULT_PATH"
  echo "Then run: npm run dev"
  exit 1
fi

# Deps
if [[ ! -d "$BRAIN_DIR/node_modules" ]]; then
  echo "[dev] Installing brain dependencies..."
  (cd "$BRAIN_DIR" && npm install)
fi

# Doctor before starting
(cd "$BRAIN_DIR" && npm run doctor) || {
  echo "[dev] doctor reported failures; fix the above before running brain"
  exit 1
}

echo "[dev] Starting brain (Socket Mode; no public URL needed)..."
exec node "$BRAIN_DIR/src/index.js"

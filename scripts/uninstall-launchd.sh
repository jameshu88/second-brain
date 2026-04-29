#!/usr/bin/env bash
set -euo pipefail

LABEL="com.secondbrain.brain"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "[uninstall-launchd] removed: $PLIST"
else
  echo "[uninstall-launchd] not installed: $PLIST"
fi

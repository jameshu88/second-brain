#!/usr/bin/env bash
# Install the brain service as a per-user LaunchAgent.
set -euo pipefail

LABEL="com.secondbrain.brain"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/secondbrain"

if [[ -z "$NODE_BIN" ]]; then
  echo "[install-launchd] node not found in PATH. Install Node 18+ first." >&2
  exit 1
fi

mkdir -p "$PLIST_DIR" "$LOG_DIR"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${NODE_BIN}</string>
      <string>${ROOT}/services/brain/src/index.js</string>
    </array>
    <key>WorkingDirectory</key><string>${ROOT}/services/brain</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ProcessType</key><string>Interactive</string>
    <key>StandardOutPath</key><string>${LOG_DIR}/brain.log</string>
    <key>StandardErrorPath</key><string>${LOG_DIR}/brain.err</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
  </dict>
</plist>
EOF

# Reload (unload first if previously loaded; ignore errors)
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "[install-launchd] installed: $PLIST"
echo "[install-launchd] logs:      $LOG_DIR/brain.{log,err}"
echo "[install-launchd] status:    launchctl list | grep ${LABEL}"

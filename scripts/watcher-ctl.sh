#!/bin/bash
# watcher-ctl.sh — Manage the Telex watcher via macOS launchd
#
# Usage:
#   watcher-ctl.sh start [iterm-session-id]
#   watcher-ctl.sh stop
#   watcher-ctl.sh status
#
# The watcher is managed as a launchd user agent with KeepAlive=true,
# so it auto-restarts if it dies. This makes it fully persistent —
# it survives Claude Code /clear, session resets, and terminal closures.
# The session ID is optional — the watcher discovers Claude sessions dynamically.

LABEL="com.telex.watcher"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
NODE="$(which node 2>/dev/null || echo /usr/local/bin/node)"
TELEX_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="/tmp/telex-watch.log"

cmd_start() {
  local session_id="${1:-}"

  # Stop existing watcher if running
  cmd_stop 2>/dev/null

  # Build ProgramArguments — session ID is optional
  local args_xml="    <string>${NODE}</string>
    <string>${TELEX_DIR}/dist/index.js</string>
    <string>watch</string>"
  if [ -n "$session_id" ]; then
    args_xml="${args_xml}
    <string>${session_id}</string>"
  fi

  # Resolve Telegram API credentials from env or ~/.telex/credentials
  local creds_file="$HOME/.telex/credentials"
  local tg_api_id="${TELEGRAM_API_ID:-}"
  local tg_api_hash="${TELEGRAM_API_HASH:-}"
  if [ -z "$tg_api_id" ] || [ -z "$tg_api_hash" ]; then
    if [ -f "$creds_file" ]; then
      # shellcheck disable=SC1090
      source "$creds_file"
      tg_api_id="${TELEGRAM_API_ID:-}"
      tg_api_hash="${TELEGRAM_API_HASH:-}"
    fi
  fi
  if [ -z "$tg_api_id" ] || [ -z "$tg_api_hash" ]; then
    echo "ERROR: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set."
    echo "Either export them or put them in ~/.telex/credentials"
    exit 1
  fi

  # Write plist
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TELEGRAM_API_ID</key>
    <string>${tg_api_id}</string>
    <key>TELEGRAM_API_HASH</key>
    <string>${tg_api_hash}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
${args_xml}
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG}</string>
  <key>StandardErrorPath</key>
  <string>${LOG}</string>
  <key>ThrottleInterval</key>
  <integer>3</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
PLIST

  # Load the agent
  launchctl load "$PLIST" 2>/dev/null
  if [ -n "$session_id" ]; then
    echo "Watcher started (launchd: ${LABEL}, session: ${session_id})"
  else
    echo "Watcher started (launchd: ${LABEL}, no initial session — will discover dynamically)"
  fi
}

cmd_stop() {
  if [ -f "$PLIST" ]; then
    launchctl unload "$PLIST" 2>/dev/null
    rm -f "$PLIST"
    echo "Watcher stopped (launchd agent removed)"
  else
    echo "Watcher not running (no plist found)"
  fi
}

cmd_status() {
  if launchctl list "$LABEL" > /dev/null 2>&1; then
    local pid
    pid=$(launchctl list "$LABEL" 2>/dev/null | head -1 | awk '{print $1}')
    echo "Watcher: RUNNING (launchd, PID: ${pid})"
  else
    echo "Watcher: NOT RUNNING"
  fi

  if [ -f "$LOG" ]; then
    echo "Log (last 3 lines):"
    tail -3 "$LOG"
  fi
}

case "${1:-}" in
  start)  cmd_start "$2" ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  *)
    echo "Usage: watcher-ctl.sh {start|stop|status} [session-id]"
    exit 1
    ;;
esac

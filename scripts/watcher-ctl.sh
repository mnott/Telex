#!/bin/bash
# watcher-ctl.sh — Manage the Telex watcher via macOS launchd or a Linux systemd user unit
#
# Usage:
#   watcher-ctl.sh start [session-id]
#   watcher-ctl.sh stop
#   watcher-ctl.sh status
#   watcher-ctl.sh plist [session-id]   # write the launchd plist / systemd unit only, load nothing
#
# The watcher is managed as a launchd user agent with KeepAlive=true,
# so it auto-restarts if it dies. This makes it fully persistent —
# it survives Claude Code /clear, session resets, and terminal closures.
# The session ID is optional — the watcher discovers Claude sessions dynamically.

LABEL="com.telex.watcher"
# WATCHER_PLIST / WATCHER_LOG / WATCHER_NO_LOAD: test seam — write elsewhere, never touch launchd.
PLIST="${WATCHER_PLIST:-$HOME/Library/LaunchAgents/${LABEL}.plist}"
launchd() { [ "${WATCHER_NO_LOAD:-}" = 1 ] || launchctl "$@"; }
NODE="$(which node 2>/dev/null || echo /usr/local/bin/node)"
TELEX_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# WATCHER_PLATFORM (Darwin|Linux) overrides uname; WATCHER_UNIT is the systemd unit path;
# WATCHER_NO_LOAD=1 also skips systemctl.
PLATFORM="${WATCHER_PLATFORM:-$(uname -s)}"
UNIT_NAME="telex-watcher.service"
UNIT="${WATCHER_UNIT:-$HOME/.config/systemd/user/${UNIT_NAME}}"
if [ "$PLATFORM" = Linux ]; then
  LOG="${WATCHER_LOG:-$HOME/.local/state/telex/watch.log}"
else
  LOG="${WATCHER_LOG:-/tmp/telex-watch.log}"
fi

# XML-escape a value for a plist <string>.
xml_esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# Escape a value for a double-quoted systemd string: \ -> \\, " -> \", % -> %%.
sd_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/%/%%/g'; }
# ExecStart additionally expands $VAR, so double the $.
sd_esc_exec() { sd_esc "$1" | sed -e 's/\$/$$/g'; }

systemd() { [ "${WATCHER_NO_LOAD:-}" = 1 ] || systemctl --user "$@"; }

# Resolve Telegram API credentials from env or ~/.telex/credentials (sets tg_api_id/tg_api_hash).
load_creds() {
  local creds_file="$HOME/.telex/credentials"
  tg_api_id="${TELEGRAM_API_ID:-}"
  tg_api_hash="${TELEGRAM_API_HASH:-}"
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
}

write_unit() {
  local session_id="${1:-}" name exec_line env_lines
  load_creds
  exec_line="\"$(sd_esc_exec "$NODE")\" \"$(sd_esc_exec "$TELEX_DIR/dist/index.js")\" watch"
  [ -n "$session_id" ] && exec_line="${exec_line} \"$(sd_esc_exec "$session_id")\""
  env_lines="Environment=\"PATH=$(sd_esc "$PATH")\"
Environment=\"TELEGRAM_API_ID=$(sd_esc "$tg_api_id")\"
Environment=\"TELEGRAM_API_HASH=$(sd_esc "$tg_api_hash")\""
  while IFS= read -r name; do
    env_lines="${env_lines}
Environment=\"${name}=$(sd_esc "${!name}")\""
  done < <(compgen -e | grep -E '^(AIBROKER|TELEX)_')

  mkdir -p "$(dirname "$UNIT")" "$(dirname "$LOG")"
  chmod 700 "$(dirname "$LOG")"
  (umask 077; touch "$LOG")
  chmod 600 "$LOG"
  (umask 077; cat > "$UNIT" <<UNITFILE
[Unit]
Description=Telex watcher (Telegram adapter for AIBroker)

[Service]
ExecStart=${exec_line}
${env_lines}
UMask=0077
Restart=on-failure
RestartSec=3
StandardOutput=append:${LOG}
StandardError=append:${LOG}

[Install]
WantedBy=default.target
UNITFILE
  )
}

linger_hint() {
  if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" = no ]; then
    echo "Note: linger is off, so the watcher stops when you log out. Run: loginctl enable-linger $(id -un)"
  fi
}

cmd_start_linux() {
  cmd_stop_linux >/dev/null 2>&1
  write_unit "$1"
  systemd daemon-reload
  systemd enable --now "$UNIT_NAME"
  echo "Watcher started (systemd user unit: ${UNIT_NAME}, log: ${LOG})"
  [ "${WATCHER_NO_LOAD:-}" = 1 ] || linger_hint
}

cmd_stop_linux() {
  if [ -f "$UNIT" ]; then
    systemd disable --now "$UNIT_NAME" 2>/dev/null
    rm -f "$UNIT"
    systemd daemon-reload
    echo "Watcher stopped (systemd unit removed)"
  else
    echo "Watcher not running (no unit found)"
  fi
}

cmd_status_linux() {
  if systemctl --user is-active --quiet "$UNIT_NAME" 2>/dev/null; then
    echo "Watcher: RUNNING (systemd, PID: $(systemctl --user show -p MainPID --value "$UNIT_NAME"))"
  else
    echo "Watcher: NOT RUNNING"
  fi
  [ -f "$LOG" ] && { echo "Log (last 3 lines):"; tail -3 "$LOG"; }
  linger_hint
}

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

  # launchd does not inherit the shell environment: pass PATH (ffmpeg/whisper live
  # in /opt/homebrew/bin) and every AIBROKER_* / TELEX_* variable through.
  local env_xml="    <key>PATH</key>
    <string>$(xml_esc "$PATH")</string>
    <key>TELEGRAM_API_ID</key>
    <string>$(xml_esc "$tg_api_id")</string>
    <key>TELEGRAM_API_HASH</key>
    <string>$(xml_esc "$tg_api_hash")</string>"
  local name
  while IFS= read -r name; do
    env_xml="${env_xml}
    <key>$(xml_esc "$name")</key>
    <string>$(xml_esc "${!name}")</string>"
  done < <(compgen -e | grep -E '^(AIBROKER|TELEX)_')

  # The log holds daemon output: create it 0600 and tighten it on every start.
  (umask 077; touch "$LOG")
  chmod 600 "$LOG"

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
${env_xml}
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
  launchd load "$PLIST" 2>/dev/null
  if [ -n "$session_id" ]; then
    echo "Watcher started (launchd: ${LABEL}, session: ${session_id})"
  else
    echo "Watcher started (launchd: ${LABEL}, no initial session — will discover dynamically)"
  fi
}

cmd_stop() {
  if [ -f "$PLIST" ]; then
    launchd unload "$PLIST" 2>/dev/null
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

if [ "$PLATFORM" = Linux ]; then
  case "${1:-}" in
    start)  cmd_start_linux "${2:-}"; exit ;;
    stop)   cmd_stop_linux; exit ;;
    status) cmd_status_linux; exit ;;
    plist)  write_unit "${2:-}"; echo "$UNIT"; exit ;;
  esac
elif [ "${1:-}" = plist ]; then
  WATCHER_NO_LOAD=1; cmd_start "${2:-}"; exit
fi

case "${1:-}" in
  start)  cmd_start "${2:-}" ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  *)
    echo "Usage: watcher-ctl.sh {start|stop|status|plist} [session-id]"
    exit 1
    ;;
esac

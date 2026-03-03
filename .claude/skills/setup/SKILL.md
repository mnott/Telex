---
name: setup
description: >
  Install and configure Telex from a local clone or GitHub URL. USE WHEN user
  says "set up Telex", "install Telex", "configure Telex", "set up Telegram
  integration", "install from github.com/mnott/Telex", "clone Telex", OR user
  has just cloned the repo and asks Claude to get it running. Covers clone (if
  needed), prerequisites, build, MCP config, watcher launchd service, Telegram
  authentication, and post-setup verification.
---

# Telex Setup Skill

Complete autonomous setup of Telex from a local clone. Ask the user for input only
when Telegram authentication requires a phone number or verification code.

---

## Context

Telex has two components:

1. **MCP server** (`dist/index.js`) — a thin IPC proxy started by Claude Code. Provides
   the `telegram_*` tools. Connects to the watcher over a Unix Domain Socket.
2. **Watcher daemon** (`dist/index.js watch`) — a long-running background process that
   owns the Telegram (GramJS MTProto) connection and delivers incoming messages to iTerm2
   via AppleScript. Managed by macOS launchd as `com.telex.watcher`.

The repo path is needed throughout. Determine it before starting:

```bash
REPO="$(pwd)"   # if already in the repo
# or use the path the user provided
```

---

## Step 0: Clone (if applicable)

If the user does NOT already have a local clone, clone first:

```bash
git clone https://github.com/mnott/Telex.git ~/dev/ai/Telex
REPO="$HOME/dev/ai/Telex"
```

Use the user's preferred path if specified, otherwise default to `~/dev/ai/Telex`.
If already in the repo directory, skip this step and set `REPO="$(pwd)"`.

---

## Step 1: Check Prerequisites

Run these checks. Report failures but continue to gather all issues before stopping.

```bash
# Node.js version (must be >= 18)
node --version

# macOS check (watcher requires macOS + iTerm2 + AppleScript)
sw_vers -productVersion

# iTerm2 installed
ls /Applications/iTerm.app 2>/dev/null && echo "iTerm2: OK" || echo "iTerm2: NOT FOUND — install from https://iterm2.com"

# ffmpeg (required for TTS voice notes — WAV to OGG conversion)
which ffmpeg && echo "ffmpeg: OK" || echo "ffmpeg: NOT FOUND — install with: brew install ffmpeg"

# whisper (optional — only needed to receive voice notes from phone)
which whisper 2>/dev/null && echo "whisper: OK" || echo "whisper: optional — install with: pip install openai-whisper"

# Telegram API credentials
[ -n "$TELEGRAM_API_ID" ] && echo "TELEGRAM_API_ID: OK" || echo "TELEGRAM_API_ID: NOT SET — get from https://my.telegram.org"
[ -n "$TELEGRAM_API_HASH" ] && echo "TELEGRAM_API_HASH: OK" || echo "TELEGRAM_API_HASH: NOT SET — get from https://my.telegram.org"
```

If Node.js is below 18, stop and tell the user to upgrade.
If iTerm2 is missing, stop — the watcher cannot deliver messages without it.
If Telegram API credentials are missing, tell the user how to get them from my.telegram.org
and set them in their shell profile (`~/.zshrc` or `~/.bashrc`).
ffmpeg and whisper can be installed after setup if needed.

---

## Step 2: Install Dependencies

```bash
cd "$REPO"
npm install
```

This installs all dependencies including **aibroker** (the shared core library)
from npm. No manual linking or local setup of aibroker is required. If you also
have Whazaa (WhatsApp bridge) installed, each project has its own `node_modules/`
— they share the same aibroker package independently via npm.

Verify `node_modules` was created. If npm fails, check Node.js version and network access.

---

## Step 3: Build

```bash
cd "$REPO"
npm run build
```

Verify `dist/index.js` exists after the build:

```bash
ls "$REPO/dist/index.js" && echo "Build OK" || echo "Build FAILED"
```

If the build fails, report the compiler error to the user and stop.

---

## Step 4: Configure MCP

Add Telex to `~/.claude.json` pointing to the local build. Using a local path
(not `npx @tekmidian/telex`) ensures Claude Code uses this specific build.

Read the current file first to avoid clobbering existing entries:

```bash
cat ~/.claude.json 2>/dev/null || echo "File does not exist"
```

Then write the updated config. The key change from the `npx` default: use `node` +
the absolute path to `dist/index.js`.

Example config block to merge in:

```json
{
  "mcpServers": {
    "telex": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/Telex/dist/index.js"]
    }
  }
}
```

Replace `/ABSOLUTE/PATH/TO/Telex` with the actual repo path.

Verification:

```bash
cat ~/.claude.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('telex entry:', d.get('mcpServers',{}).get('telex'))"
```

Also ensure `~/.claude/settings.json` has `"mcp__telex"` in the `permissions.allow` array.
Without this, Claude Code will prompt for permission on every tool call.

```json
{
  "permissions": {
    "allow": ["mcp__telex"]
  }
}
```

Merge this into the existing `settings.json` — do not overwrite other entries.

---

## Step 5: Set Up Watcher Launchd Service

The watcher must run as a persistent macOS launchd user agent so it:
- Starts automatically on login
- Restarts if it crashes
- Can call AppleScript to control iTerm2 (requires `LimitLoadToSessionType: Aqua`)

Use the control script bundled in the repo:

```bash
bash "$REPO/scripts/watcher-ctl.sh" start
```

The script writes the plist to `~/Library/LaunchAgents/com.telex.watcher.plist` and
loads it. It uses `KeepAlive: true` so launchd restarts the watcher automatically.

Verify the watcher loaded:

```bash
bash "$REPO/scripts/watcher-ctl.sh" status
```

Expected output: `Watcher: RUNNING (launchd, PID: XXXXX)`

If the watcher is not running after `start`, check the log:

```bash
tail -20 /tmp/telex-watch.log
```

Common causes of failure at this stage:
- Build not complete (dist/index.js missing) — run Step 3 again
- Node not found at the path watcher-ctl.sh resolved — check `which node`
- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` not set — the watcher exits immediately

---

## Step 6: Telegram Authentication (USER INTERACTION REQUIRED)

Tell the user:

> The next step requires Telegram authentication. You will need to enter your
> phone number and a verification code sent to your Telegram app.
>
> Make sure `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are set in your environment.
>
> Ready? I will start the authentication flow now.

Run the built-in setup wizard:

```bash
node "$REPO/dist/index.js" setup
```

This command:
1. Checks for `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` environment variables
2. Ensures `~/.telex/` directory exists
3. Prompts for phone number (interactive)
4. Sends verification code to Telegram app
5. Prompts for the verification code (interactive)
6. Saves session to `~/.telex/session/`
7. Configures `~/.claude.json` if not already done

Wait for success output. If authentication fails, check that API credentials are correct.

---

## Step 7: Verify

Restart Claude Code is needed for the MCP config to take effect. Tell the user:

> Please restart Claude Code now so the Telex MCP server is loaded.

After Claude Code restarts, verify:

```bash
# Watcher is running
bash "$REPO/scripts/watcher-ctl.sh" status

# Watcher log shows connection
tail -5 /tmp/telex-watch.log

# Auth credentials exist
ls -la ~/.telex/session/
```

Then call the MCP tool directly to confirm end-to-end connectivity:

```
telegram_status
```

Expected: Connected status with your Telegram account info.

If `telegram_status` returns "Watcher not running", the launchd service did not load
correctly. Run `bash "$REPO/scripts/watcher-ctl.sh" start` again and check the log.

---

## Step 8: Post-Setup Recommendations

Tell the user the following CLAUDE.md additions will make Telex significantly more
useful. Offer to add them to `~/.claude/CLAUDE.md` (global) or a project-level
`CLAUDE.md`.

### Mirror every response to Telegram

```
Every response you give on the terminal MUST also be sent to Telegram via telegram_send.
Send the same content — do not shorten or paraphrase.
Adapt markdown for Telegram: use **bold** and *italic* only. No headers, no code blocks.
```

### Acknowledge before long tasks

```
If a task will take more than a few seconds, your FIRST tool call must be
telegram_send with a brief acknowledgment (e.g. "On it — researching that now.").
Then proceed with the actual work. Never leave Telegram silent while working.
```

### Drain the queue at session start

```
At the start of every session, call telegram_receive to drain any queued
messages that arrived while you were offline.
```

---

## Troubleshooting Reference

| Symptom | Fix |
|---------|-----|
| `Tools return "Watcher not running"` | `bash scripts/watcher-ctl.sh start` |
| Authentication failed | Check `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`, re-run `node dist/index.js setup` |
| Messages not typing into Claude | Verify iTerm2 Automation permission in System Settings > Privacy & Security > Automation |
| TTS fails with "ffmpeg not found" | `brew install ffmpeg` |
| MCP server disconnects repeatedly | `pkill -f "telex"` then let Claude Code restart it |
| `Cannot find module 'aibroker'` | `npm install` was not run or failed — re-run Step 2 |
| iTerm2 Automation dialog appeared | Click OK; if you clicked "Don't Allow", grant permission manually in System Settings |
| Watcher exits immediately | Check `/tmp/telex-watch.log` — likely missing API credentials |

---

## Summary Checklist

- [ ] Node.js >= 18
- [ ] iTerm2 installed
- [ ] ffmpeg installed (for TTS)
- [ ] `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` set
- [ ] `npm install` completed
- [ ] `npm run build` completed — `dist/index.js` exists
- [ ] `~/.claude.json` has `telex` entry pointing to local `dist/index.js`
- [ ] Watcher launchd service loaded and running (`com.telex.watcher`)
- [ ] Telegram session authenticated — `~/.telex/session/` exists
- [ ] Claude Code restarted
- [ ] `telegram_status` returns Connected
- [ ] CLAUDE.md updated with Telegram mirroring rules (recommended)

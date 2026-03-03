# Telex

Your phone is now a Claude Code terminal — via Telegram. Send a message to your Saved Messages, Claude gets it. Claude responds, you see it on Telegram. Text, images, voice notes — in both directions.

Dictate a voice note while driving and Claude starts coding. Send an image from your phone and Claude interprets it. Get spoken responses back in any of 28 voices — all synthesized locally, nothing leaves your machine. Take complete control of your computer using `/t` to open and manage any number of terminal sessions. Manage multiple Claude sessions from your couch with `/s`, switch between them, or `/kill` a stuck one and restart it fresh. Take screenshots of any session using `/ss` and have the screenshot sent to you via Telegram.

One command to set up. Zero cloud dependencies for voice. Works with any Telegram account.

---

## How it works

Telex has two components:

**Watcher daemon** — a long-running process that owns the Telegram connection (via the [GramJS](https://github.com/nicedoc/gramjs) MTProto library). It delivers incoming messages to iTerm2 by typing them into your Claude session via AppleScript. It also serves a Unix Domain Socket so MCP server instances can send and receive messages without holding their own connection.

**MCP server** — a thin IPC proxy started by Claude Code. It has no direct Telegram connection. Every tool call is forwarded to the watcher over the socket and the response returned to Claude.

```
Your phone
    |
    | Telegram (GramJS MTProto)
    |
  Watcher daemon  <── launchd, auto-restarts
    |
    |── AppleScript ──> iTerm2 ──> Claude Code (types message into terminal)
    |
    |── Unix Domain Socket (/tmp/telex-watcher.sock)
              |
              └──> MCP Server (started by Claude Code)
                       |
                       └──> telegram_send / receive / status / wait / login
                            telegram_tts / telegram_speak / telegram_voice_config
```

The separation means you can have multiple Claude Code sessions open simultaneously. Each MCP server instance registers its `TERM_SESSION_ID` with the watcher. The first session to register becomes the active recipient for incoming messages; use `/N` from Telegram or `telegram_switch` to change the active session.

---

## Architecture

Telex is built on [aibroker](https://www.npmjs.com/package/aibroker) — a shared
core library that provides the platform-independent infrastructure:

```
aibroker (shared core — installed automatically via npm)
├── Logging, session state, message queuing
├── File persistence (parameterized data directory)
├── Unix Domain Socket IPC (server + client)
├── macOS iTerm2 adapter (AppleScript, tab management)
├── Kokoro TTS (local speech synthesis + Whisper transcription)
└── SessionBackend (deliver messages by typing into iTerm2)

Whazaa (WhatsApp bridge)          Telex (this package)
├── Baileys connection             ├── GramJS MTProto connection
├── WhatsApp formatting            ├── Telegram formatting
├── MCP tools (whatsapp_*)         ├── MCP tools (telegram_*)
└── Desktop DB integration         └── ...
```

If you install multiple bridges (Whazaa + Telex), each has its own
`node_modules/` — no conflicts. They share the same iTerm2 session
infrastructure at runtime through macOS AppleScript.

---

## Quick start

Tell Claude Code:

> Clone https://github.com/mnott/Telex and set it up for me

Claude clones the repo, finds the setup skill, and handles everything autonomously — prerequisites, build, MCP config, watcher daemon, and Telegram authentication. The only thing you do is enter your phone number and verification code when prompted.

### Alternative: npx

If you prefer a traditional install without cloning:

```bash
npx -y @tekmidian/telex setup
```

This will:
1. Add Telex to `~/.claude.json`
2. Print instructions for starting the watcher and authenticating
3. Credentials are saved to `~/.telex/auth/` on first `telex watch`

Restart Claude Code. Telex connects automatically from now on.

### Manual install

```bash
git clone https://github.com/mnott/Telex.git
cd Telex
npm install
npm run build
```

Then tell Claude to set it up from the local clone.

---

## Prerequisites

- Node.js >= 18
- macOS with [iTerm2](https://iterm2.com/) for the `watch` command and iTerm2 delivery
- [ffmpeg](https://ffmpeg.org/) for TTS voice note conversion (WAV to OGG Opus)
- [Whisper](https://github.com/openai/whisper) for voice note transcription (optional — only needed to receive audio/voice messages)
- Telegram API credentials (`TELEGRAM_API_ID` and `TELEGRAM_API_HASH`) from [my.telegram.org](https://my.telegram.org)

Install ffmpeg and Whisper via Homebrew:

```bash
brew install ffmpeg
pip install openai-whisper
```

### Getting Telegram API credentials

1. Go to [my.telegram.org](https://my.telegram.org) and log in with your phone number
2. Click "API development tools"
3. Create a new application (any name/description)
4. Copy the `api_id` (number) and `api_hash` (string)
5. Set them as environment variables:

```bash
export TELEGRAM_API_ID=12345678
export TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890
```

Add these to your `~/.zshrc` or `~/.bashrc` for persistence.

---

## How to Use

Once Telex is set up, you talk to Claude in plain language. You never need to know about tool names or parameters — just say what you want.

### Sending Messages

Tell Claude what to say and to whom:

- "Send Randolf a Telegram message saying I'll be late"
- "Tell Nicole on Telegram the meeting is moved to 3pm"
- "Message my Saved Messages: pick up milk"

If you don't say who to send it to, Claude sends to your Telegram Saved Messages — useful for notes to yourself.

### Voice Notes

Claude can send a Telegram voice note instead of a text message:

- "Send me a voice note saying good morning"
- "Send a voice note to Nicole saying I'm on my way"

You can choose whose voice to use:

- "Say it as George" or "Use George's voice"
- "Use Nicole's voice for this"

See the full voice list in the `telegram_tts` section below.

### Listening Locally (Mac Speakers)

Claude can speak out loud through your Mac — no Telegram needed:

- "Say that out loud"
- "Read that to me"

### Voice Mode — Hands-Free

Put Claude into persistent voice mode so every response comes back as audio automatically.

- "Voice mode on" — every Claude response becomes a Telegram voice note
- "Back to text" — back to normal text messages
- "Talk to me locally" — every response plays through your speakers

Voice mode is perfect for driving, cooking, or any time you can't look at a screen.

### Screenshots

Send `/ss` from your phone and the watcher captures the active Claude session's iTerm2 window and sends it back to Telegram as an image.

### Session Management (from Your Phone)

Control your Claude sessions from Telegram:

- `/s` — see a list of your active Claude sessions
- `/2` — switch to session 2
- `/2 Cooking Project` — switch to session 2 and name it
- `/n` — create a new Claude session

---

## MCP tools

Once configured, Claude Code has 19 tools available:

| Tool | Description |
|------|-------------|
| `telegram_status` | Check Telegram connection status |
| `telegram_send` | Send a text message (to Saved Messages or any contact) |
| `telegram_tts` | Send a voice note via TTS (Kokoro, local synthesis) |
| `telegram_send_file` | Send a file (with optional caption and prettify) |
| `telegram_receive` | Drain buffered incoming messages |
| `telegram_wait` | Long-poll for incoming messages (up to timeout) |
| `telegram_login` | Trigger fresh Telegram authentication |
| `telegram_contacts` | List Telegram contacts |
| `telegram_chats` | List Telegram chats |
| `telegram_history` | Get message history for a chat |
| `telegram_voice_config` | Get or set voice/TTS configuration |
| `telegram_speak` | Play TTS locally through Mac speakers |
| `telegram_rename` | Rename the current Claude session |
| `telegram_restart` | Restart the current Claude session |
| `telegram_discover` | Discover and prune Claude sessions |
| `telegram_sessions` | List all Claude sessions |
| `telegram_switch` | Switch to a different Claude session |
| `telegram_end_session` | End (close) a Claude session |
| `telegram_command` | Execute a slash command directly (bypass Telegram round-trip) |

### telegram_status

Takes no parameters. Returns connection state, authenticated phone number, and watcher uptime.

### telegram_send

Sends a text message to your Saved Messages or any contact.

Parameters:
- `message` (required) — the text to send
- `recipient` (optional) — username, phone number, chat ID, or display name; omit for Saved Messages
- `voice` (optional, boolean) — if `true`, send as a TTS voice note instead of text

### telegram_tts

Converts text to speech and sends it as a Telegram voice note.

- Uses [Kokoro-js](https://github.com/hexgrad/kokoro) — 100% local, no internet required after first run
- The model (~160 MB) is downloaded on first use and cached locally
- Requires `ffmpeg` for WAV to OGG Opus conversion

Parameters:
- `text` (required) — text to convert to speech
- `recipient` (optional) — username, phone number, chat ID, or display name; omit for Saved Messages
- `voice` (optional) — voice name from the table below; omit to use the configured default

**Available voices (28 total):**

| Category | Voices |
|----------|--------|
| American Female | `af_heart`, `af_alloy`, `af_aoede`, `af_bella`, `af_jessica`, `af_kore`, `af_nicole`, `af_nova`, `af_river`, `af_sarah`, `af_sky` |
| American Male | `am_adam`, `am_echo`, `am_eric`, `am_fenrir`, `am_liam`, `am_michael`, `am_onyx`, `am_puck`, `am_santa` |
| British Female | `bf_alice`, `bf_emma`, `bf_isabella`, `bf_lily` |
| British Male | `bm_daniel`, `bm_fable`, `bm_george`, `bm_lewis` |

Default voice: `bm_fable`

### telegram_send_file

Sends a file as a Telegram document, or optionally as inline formatted messages.

Parameters:
- `filePath` (required) — absolute path to the file
- `recipient` (optional) — username, phone number, chat ID, or display name; omit for Saved Messages
- `caption` (optional) — caption text to attach to the file
- `prettify` (optional, boolean) — if `true`, send the file contents as formatted inline Telegram messages rather than a document attachment; useful for markdown files you want to read in chat

### telegram_receive

Drains all messages buffered for the current session since the last call.

Parameters:
- `from` (optional) — omit for Saved Messages only, `"all"` for all sources, or a chat ID/name to filter

### telegram_wait

Efficient alternative to polling. Blocks until a message arrives or the timeout expires.

Parameters:
- `timeoutMs` (optional) — max wait in milliseconds; default 120000, max 300000

Use this when you want Claude to wait while you compose a reply:

```
"Wait for my next Telegram message before continuing."
```

### telegram_login

Takes no parameters. Triggers a fresh Telegram authentication flow. Use this if the session has expired or credentials have been revoked.

### telegram_contacts

Lists your Telegram contacts.

Parameters:
- `search` (optional) — filter by name or username
- `limit` (optional) — maximum results to return

### telegram_chats

Lists your Telegram chats (groups, channels, and direct messages).

Parameters:
- `search` (optional) — filter by chat name
- `limit` (optional, default 50) — maximum results to return

Chat IDs returned here can be passed directly to `telegram_history`.

### telegram_history

Fetches message history for a chat.

Parameters:
- `chatId` (required) — chat ID, username, or `'me'` for Saved Messages
- `count` (optional, default 20) — number of messages to return (most recent first)

### telegram_voice_config

Gets or sets the voice mode configuration. Configuration is persisted to `~/.telex/voice-config.json` and survives watcher restarts.

Parameters:
- `action` (required) — `'get'` to read current config, `'set'` to update it
- `defaultVoice` (optional) — default voice name (e.g. `'bm_fable'`)
- `voiceMode` (optional, boolean) — `true` to enable automatic voice responses
- `localMode` (optional, boolean) — when `true` and `voiceMode` is `true`, use `telegram_speak` (Mac speakers) instead of `telegram_tts` (Telegram voice notes)
- `personas` (optional) — map of names to voice IDs (e.g. `{"Nicole": "af_nicole", "George": "bm_george"}`)

Default personas: Nicole → `af_nicole`, George → `bm_george`, Daniel → `bm_daniel`, Fable → `bm_fable`

### telegram_speak

Same TTS engine as `telegram_tts`, but plays audio through the Mac's speakers instead of sending a Telegram voice note. No Telegram connection required. Audio plays in the background without blocking other operations.

Parameters:
- `text` (required) — text to speak aloud
- `voice` (optional) — voice name (same list as `telegram_tts`); omit to use the configured default

### telegram_rename

Renames the current Claude session (the iTerm2 tab name and session registry entry).

Parameters:
- `name` (required) — new session name

### telegram_restart

Takes no parameters. Restarts the current Claude session: sends SIGTERM to the Claude process, waits for the shell prompt, then types `claude` to relaunch in the same directory.

### telegram_discover

Takes no parameters. Scans all iTerm2 sessions for running Claude instances, updates the session registry, and prunes stale entries.

### telegram_sessions

Takes no parameters. Returns the full list of registered Claude sessions with their names, indices, and active status.

### telegram_switch

Switches incoming message routing to a different Claude session.

Parameters:
- `target` (required) — session index (1-based) or a substring of the session name

After switching, all incoming Telegram messages are delivered to the new session.

### telegram_end_session

Closes a Claude session by sending SIGTERM and removing it from the registry.

Parameters:
- `target` (required) — session index (1-based) or a substring of the session name

### telegram_command

Executes a Telegram slash command directly from Claude without a round-trip through the Telegram app. Useful for scripting session management.

Parameters:
- `text` (required) — command text, e.g. `/sessions`, `/restart`, `/ss`

---

## Telegram commands

Messages sent from your phone starting with `/` are intercepted by the watcher:

| Command | Description |
|---------|-------------|
| `/h` or `/help` | Show help |
| `/s` or `/sessions` | List open sessions (Claude and terminal) |
| `/N` or `/N name` | Switch to session N (optionally rename) |
| `/n` or `/new` | Create a new Claude session |
| `/c` | Clear context and resume (`/clear` + `go`) |
| `/ss` or `/screenshot` | Capture active session's iTerm2 window |
| `/cc` | Send Ctrl+C (interrupt) |
| `/esc` | Send Escape |
| `/enter` | Send Enter/Return |
| `/tab` | Send Tab (trigger completion) |
| `/up` `/down` `/left` `/right` | Arrow keys |
| `/p` | Pause session |
| `/pick N [text]` | Select menu option N, optionally type text |
| `/restart` | Restart the watcher |

### Keyboard control

Send raw keystrokes to the active iTerm2 session from your phone:

| Command | Keystroke | Use case |
|---------|-----------|----------|
| `/cc` | Ctrl+C | Interrupt a running process |
| `/esc` | Escape | Dismiss a dialog, exit a mode |
| `/enter` | Return | Confirm a prompt |
| `/tab` | Tab | Trigger shell completion |
| `/up` | Up arrow | Previous history / menu up |
| `/down` | Down arrow | Next history / menu down |
| `/pick N` | Down x (N-1) + Enter | Select the Nth option in a menu |

---

## Multiple sessions

Telex supports multiple simultaneous Claude Code windows. Each MCP server instance registers its `TERM_SESSION_ID` when it starts. The first session to register becomes the active recipient for incoming messages and stays active until explicitly switched or disconnected.

The watcher maintains a separate incoming message queue for each registered session. Use `/N name` from Telegram or `telegram_switch` from MCP to change which session receives incoming messages. Sending a message does **not** automatically change the active session.

Sessions register with a name derived from the working directory (e.g. a Claude session in `~/projects/myapp` registers as `myapp`). Use `/s` to see all sessions and `/N name` to assign a custom name.

Routing is sticky: only the `/N` command changes the active session, not sending a message. This means switching sessions from your phone requires an explicit `/N` command.

---

## Best practices for CLAUDE.md

To get the most out of Telex, add these rules to your `CLAUDE.md` (or `~/.claude/CLAUDE.md` for global config):

### Mirror every response to Telegram

Tell Claude to send the same content it prints on the terminal to Telegram, so you can follow along from your phone:

```
Every response you give on the terminal MUST also be sent to Telegram via telegram_send.
Send the same content — do not shorten or paraphrase.
Adapt markdown for Telegram: use **bold** and *italic* only. No headers, no code blocks.
```

### Acknowledge before long tasks

If Claude is about to spawn agents, read multiple files, or do anything that takes more than a few seconds, it should send a brief Telegram message **first** — before calling any other tools. Otherwise your phone goes silent and you don't know if Claude heard you.

```
If a task will take more than a few seconds, your FIRST tool call must be
telegram_send with a brief acknowledgment (e.g. "On it — researching that now.").
Then proceed with the actual work. Never leave Telegram silent while working.
```

### Drain the queue at session start

Messages you send from your phone while Claude is generating a response may be queued. Call `telegram_receive` early in each session to catch them:

```
At the start of every session, call telegram_receive to drain any queued
messages that arrived while you were offline.
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_API_ID` | _(required)_ | Telegram API ID from my.telegram.org |
| `TELEGRAM_API_HASH` | _(required)_ | Telegram API hash from my.telegram.org |
| `TELEX_TTS_VOICE` | `bm_fable` | Default TTS voice |

---

## CLI commands

```bash
# First-time setup: configure MCP and print authentication instructions
npx -y @tekmidian/telex setup

# Start the watcher daemon (manages iTerm2 delivery and IPC)
node dist/index.js watch

# Remove MCP config and stored credentials
node dist/index.js uninstall
```

---

## Watcher daemon

The watcher is the core of Telex. It runs as a macOS launchd agent so it starts automatically and restarts if it crashes.

### Starting manually

```bash
node dist/index.js watch
```

### launchd setup (auto-start)

```bash
scripts/watcher-ctl.sh start    # Install and start as launchd agent
scripts/watcher-ctl.sh stop     # Stop and unload
scripts/watcher-ctl.sh status   # Show running state
```

The agent uses `KeepAlive: true` and `ProcessType: Interactive`. The Interactive process type and `LimitLoadToSessionType: Aqua` are required so the watcher can access the macOS GUI session and call AppleScript to control iTerm2.

---

## Manual MCP configuration

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "telex": {
      "command": "npx",
      "args": ["-y", "@tekmidian/telex"]
    }
  }
}
```

Using a local build:

```json
{
  "mcpServers": {
    "telex": {
      "command": "node",
      "args": ["/path/to/Telex/dist/index.js"]
    }
  }
}
```

---

## Troubleshooting

**"Watcher not running" errors**

The watcher daemon is not running. Start it with `node dist/index.js watch` or use `scripts/watcher-ctl.sh start`.

**Telegram authentication failed**

Ensure `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are set. Run `node dist/index.js setup` to re-authenticate.

**Messages not appearing in Claude**

Check that the watcher is running: `ps aux | grep "telex.*watch"`. Verify the session ID matches your Claude tab.

**"iTerm2 wants to control..." security prompt**

Click OK. If you clicked "Don't Allow", go to System Settings > Privacy & Security > Automation and enable iTerm2.

**TTS fails with "ffmpeg not found"**

Install ffmpeg: `brew install ffmpeg`.

**First TTS call takes a long time**

The Kokoro model (~160 MB) is downloaded on first use and cached locally. Subsequent calls are fast.

---

## Security

- Session credentials are stored locally in `~/.telex/`. Treat them like passwords — they grant full access to your Telegram session.
- Telex reads and sends messages via your Saved Messages (self-chat) by default.
- No data is sent to any third-party service beyond Telegram's servers via MTProto.
- TTS synthesis is fully local (Kokoro-js runs on-device). Audio never leaves your machine.

---

## Uninstall

```bash
node dist/index.js uninstall
```

Or with npx from the published package:

```bash
npx -y @tekmidian/telex uninstall
```

This removes Telex from `~/.claude.json` and deletes credentials from `~/.telex/auth/`. To fully clean up:

1. Stop the launchd agent: `scripts/watcher-ctl.sh stop`
2. Remove the plist: `rm ~/Library/LaunchAgents/com.telex.watcher.plist` (filename may vary — check `scripts/watcher-ctl.sh` for the exact name)
3. Run the uninstall command above to remove MCP config and auth
4. Optionally remove `~/.telex/` entirely: `rm -r ~/.telex/`

Restart Claude Code to apply.

---

## Requirements

- Node.js >= 18
- [aibroker](https://www.npmjs.com/package/aibroker) — shared core (installed automatically)
- Telegram account with API credentials
- macOS with [iTerm2](https://iterm2.com/) for the `watch` command and iTerm2 delivery
- [ffmpeg](https://ffmpeg.org/) for TTS voice note sending

---

## License

MIT — see [LICENSE](LICENSE)

## Author

Matthias Nott — [github.com/mnott](https://github.com/mnott)

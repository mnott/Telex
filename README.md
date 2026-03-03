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

### Listening Locally (Mac Speakers)

Claude can speak out loud through your Mac — no Telegram needed:

- "Say that out loud"
- "Read that to me"

### Voice Mode — Hands-Free

Put Claude into persistent voice mode so every response comes back as audio automatically.

- "Voice mode on" — every Claude response becomes a Telegram voice note
- "Back to text" — back to normal text messages
- "Talk to me locally" — every response plays through your speakers

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

Once configured, Claude Code has 20 tools available:

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
| `telegram_dictate` | Record audio via Mac microphone and transcribe |

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

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_API_ID` | _(required)_ | Telegram API ID from my.telegram.org |
| `TELEGRAM_API_HASH` | _(required)_ | Telegram API hash from my.telegram.org |
| `TELEX_TTS_VOICE` | `bm_fable` | Default TTS voice |

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
      "args": ["-y", "telex"]
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

- Session credentials are stored locally in `~/.telex/`. Treat them like passwords.
- Telex reads and sends messages via your Saved Messages (self-chat) by default.
- No data is sent to any third-party service beyond Telegram's servers via MTProto.
- TTS synthesis is fully local (Kokoro-js runs on-device). Audio never leaves your machine.

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

# Telex

Your phone is now a Claude Code terminal - via Telegram. Send a message to your Saved Messages, Claude gets it. Claude responds, you see it on Telegram. Text, images, voice notes - in both directions.

Dictate a voice note while driving and Claude starts coding. Send an image from your phone and Claude interprets it. Get spoken responses back in any of 28 voices - all synthesized locally, nothing leaves your machine. Take complete control of your computer using `/t` to open and manage any number of terminal sessions. Manage multiple Claude sessions from your couch with `/s`, switch between them, or `/kill` a stuck one and restart it fresh. Take screenshots of any session using `/ss` and have the screenshot sent to you via Telegram.

One command to set up. Zero cloud dependencies for voice. Works with any Telegram account.

---

## How it works

Telex is a thin **adapter plugin** for the [AIBroker](https://www.npmjs.com/package/aibroker) hub. It does one thing: maintain the GramJS MTProto connection to Telegram and pass messages in and out. All the intelligence - commands, session management, TTS/STT, screenshots, image generation, vision, and MCP tools - lives in the AIBroker daemon.

Telex registers with AIBroker on startup via a Unix Domain Socket. If AIBroker is not running, Telex will not function.

### Architecture

```
AIBroker Hub (daemon, launchd: com.aibroker.daemon)
- Commands, session management, TTS/STT, screenshots, image gen
- Unified MCP server (whatsapp_*, telegram_*, pailot_*, aibroker_*)
- IPC socket: /tmp/aibroker.sock

    Whazaa adapter (WhatsApp, launchd: com.whazaa.watcher)
        Baileys connection only

    Telex adapter (this package, launchd: com.telex.watcher)
        GramJS MTProto connection only

    PAILot (iOS app, WebSocket on port 8765)
```

Telex heartbeats every 30 seconds with a `ping` to the hub. All `telegram_*` MCP tools are served by AIBroker's unified MCP server - not by Telex itself.

---

## Quick start

Tell Claude Code:

> Clone https://github.com/mnott/Telex and set it up for me

Claude clones the repo, finds the setup skill, and handles everything autonomously - prerequisites, build, MCP config, adapter daemon, and Telegram authentication. The only thing you do is enter your phone number and verification code when prompted.

### Alternative: npx

If you prefer a traditional install without cloning:

```bash
npx -y @tekmidian/telex setup
```

This will:
1. Add Telex to `~/.claude.json`
2. Print instructions for starting the adapter and authenticating
3. Credentials are saved to `~/.telex/auth/` on first authentication

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
- [AIBroker](https://www.npmjs.com/package/aibroker) running as a daemon (required - Telex will not function without it)
- macOS with [iTerm2](https://iterm2.com/)
- [ffmpeg](https://ffmpeg.org/) for TTS voice note conversion (WAV to OGG Opus)
- [Whisper](https://github.com/openai/whisper) for voice note transcription (optional - only needed to receive audio/voice messages)
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

Add these to your `~/.zshrc` or `~/.bashrc` for persistence. The AIBroker daemon also reads these from `~/.aibroker/env` when running as a launchd service.

---

## How to Use

Once Telex is set up, you talk to Claude in plain language. You never need to know about tool names or parameters - just say what you want.

### Sending Messages

Tell Claude what to say and to whom:

- "Send Randolf a Telegram message saying I'll be late"
- "Tell Nicole on Telegram the meeting is moved to 3pm"
- "Message my Saved Messages: pick up milk"

If you don't say who to send it to, Claude sends to your Telegram Saved Messages - useful for notes to yourself.

### Voice Notes

Claude can send a Telegram voice note instead of a text message:

- "Send me a voice note saying good morning"
- "Send a voice note to Nicole saying I'm on my way"

You can choose whose voice to use:

- "Say it as George" or "Use George's voice"
- "Use Nicole's voice for this"

See the full voice list in the `telegram_tts` section below.

### Listening Locally (Mac Speakers)

Claude can speak out loud through your Mac - no Telegram needed:

- "Say that out loud"
- "Read that to me"

### Voice Mode - Hands-Free

Put Claude into persistent voice mode so every response comes back as audio automatically.

- "Voice mode on" - every Claude response becomes a Telegram voice note
- "Back to text" - back to normal text messages
- "Talk to me locally" - every response plays through your speakers

Voice mode is perfect for driving, cooking, or any time you can't look at a screen.

### Screenshots

Send `/ss` from your phone and the hub captures the active Claude session's iTerm2 window and sends it back to Telegram as an image.

### Session Management (from Your Phone)

Control your Claude sessions from Telegram:

- `/s` - see a list of your active Claude sessions
- `/2` - switch to session 2
- `/2 Cooking Project` - switch to session 2 and name it
- `/n` - create a new Claude session

---

## MCP tools

The following `telegram_*` tools are served by the AIBroker unified MCP server. They cover the Telegram transport layer:

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

Session management tools (rename, restart, switch, discover, end session, command) are provided as `aibroker_*` tools by the AIBroker hub and apply across all adapters - not just Telegram.

### telegram_status

Takes no parameters. Returns connection state, authenticated phone number, and adapter uptime.

### telegram_send

Sends a text message to your Saved Messages or any contact.

Parameters:
- `message` (required) - the text to send
- `recipient` (optional) - username, phone number, chat ID, or display name; omit for Saved Messages
- `voice` (optional, boolean) - if `true`, send as a TTS voice note instead of text

### telegram_tts

Converts text to speech and sends it as a Telegram voice note.

- Uses [Kokoro-js](https://github.com/hexgrad/kokoro) - 100% local, no internet required after first run
- The model (~160 MB) is downloaded on first use and cached locally
- Requires `ffmpeg` for WAV to OGG Opus conversion

Parameters:
- `text` (required) - text to convert to speech
- `recipient` (optional) - username, phone number, chat ID, or display name; omit for Saved Messages
- `voice` (optional) - voice name from the table below; omit to use the configured default

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
- `filePath` (required) - absolute path to the file
- `recipient` (optional) - username, phone number, chat ID, or display name; omit for Saved Messages
- `caption` (optional) - caption text to attach to the file
- `prettify` (optional, boolean) - if `true`, send the file contents as formatted inline Telegram messages rather than a document attachment; useful for markdown files you want to read in chat

### telegram_receive

Drains all messages buffered for the current session since the last call.

Parameters:
- `from` (optional) - omit for Saved Messages only, `"all"` for all sources, or a chat ID/name to filter

### telegram_wait

Efficient alternative to polling. Blocks until a message arrives or the timeout expires.

Parameters:
- `timeoutMs` (optional) - max wait in milliseconds; default 120000, max 300000

Use this when you want Claude to wait while you compose a reply:

```
"Wait for my next Telegram message before continuing."
```

### telegram_login

Takes no parameters. Triggers a fresh Telegram authentication flow. Use this if the session has expired or credentials have been revoked.

### telegram_contacts

Lists your Telegram contacts.

Parameters:
- `search` (optional) - filter by name or username
- `limit` (optional) - maximum results to return

### telegram_chats

Lists your Telegram chats (groups, channels, and direct messages).

Parameters:
- `search` (optional) - filter by chat name
- `limit` (optional, default 50) - maximum results to return

Chat IDs returned here can be passed directly to `telegram_history`.

### telegram_history

Fetches message history for a chat.

Parameters:
- `chatId` (required) - chat ID, username, or `'me'` for Saved Messages
- `count` (optional, default 20) - number of messages to return (most recent first)

### telegram_voice_config

Gets or sets the voice mode configuration. Configuration is persisted and survives adapter restarts.

Parameters:
- `action` (required) - `'get'` to read current config, `'set'` to update it
- `defaultVoice` (optional) - default voice name (e.g. `'bm_fable'`)
- `voiceMode` (optional, boolean) - `true` to enable automatic voice responses
- `localMode` (optional, boolean) - when `true` and `voiceMode` is `true`, use `telegram_speak` (Mac speakers) instead of `telegram_tts` (Telegram voice notes)
- `personas` (optional) - map of names to voice IDs (e.g. `{"Nicole": "af_nicole", "George": "bm_george"}`)

Default personas: Nicole -> `af_nicole`, George -> `bm_george`, Daniel -> `bm_daniel`, Fable -> `bm_fable`

### telegram_speak

Same TTS engine as `telegram_tts`, but plays audio through the Mac's speakers instead of sending a Telegram voice note. No Telegram connection required. Audio plays in the background without blocking other operations.

Parameters:
- `text` (required) - text to speak aloud
- `voice` (optional) - voice name (same list as `telegram_tts`); omit to use the configured default

---

## Telegram commands

Messages sent from your phone starting with `/` are intercepted by the hub:

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

## Best practices for CLAUDE.md

To get the most out of Telex, add these rules to your `CLAUDE.md` (or `~/.claude/CLAUDE.md` for global config):

### Mirror every response to Telegram

Tell Claude to send the same content it prints on the terminal to Telegram, so you can follow along from your phone:

```
Every response you give on the terminal MUST also be sent to Telegram via telegram_send.
Send the same content - do not shorten or paraphrase.
Adapt markdown for Telegram: use **bold** and *italic* only. No headers, no code blocks.
```

### Acknowledge before long tasks

If Claude is about to spawn agents, read multiple files, or do anything that takes more than a few seconds, it should send a brief Telegram message **first** - before calling any other tools. Otherwise your phone goes silent and you don't know if Claude heard you.

```
If a task will take more than a few seconds, your FIRST tool call must be
telegram_send with a brief acknowledgment (e.g. "On it - researching that now.").
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

Environment variables can also be placed in `~/.aibroker/env` for the launchd daemon to pick up automatically.

---

## Adapter daemon

Telex runs as a macOS launchd agent (`com.telex.watcher`) that starts automatically and restarts if it crashes. It requires the AIBroker hub daemon (`com.aibroker.daemon`) to be running first.

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

The agent uses `KeepAlive: true` and `ProcessType: Interactive`. The Interactive process type and `LimitLoadToSessionType: Aqua` are required so the adapter can access the macOS GUI session and call AppleScript to control iTerm2.

---

## Manual MCP configuration

Telex no longer ships its own MCP server. The AIBroker unified MCP server provides all `telegram_*` tools. Add AIBroker to `~/.claude.json`:

```json
{
  "mcpServers": {
    "aibroker": {
      "command": "node",
      "args": ["/path/to/AIBroker/dist/mcp/index.js"]
    }
  }
}
```

See the [AIBroker repo](https://www.npmjs.com/package/aibroker) for full MCP setup instructions.

---

## Troubleshooting

**"Hub not running" or connection refused errors**

The AIBroker daemon is not running. Start it first - Telex cannot function without it.

**"Adapter not connected" errors**

The Telex adapter is not running or has not registered with the hub. Start it with `node dist/index.js watch` or use `scripts/watcher-ctl.sh start`.

**Telegram authentication failed**

Ensure `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are set. Run `telegram_login` from Claude or re-run setup.

**Messages not appearing in Claude**

Check that both AIBroker and Telex are running. Verify the session ID matches your Claude tab. Use `telegram_status` to confirm the adapter is connected.

**"iTerm2 wants to control..." security prompt**

Click OK. If you clicked "Don't Allow", go to System Settings > Privacy & Security > Automation and enable iTerm2.

**TTS fails with "ffmpeg not found"**

Install ffmpeg: `brew install ffmpeg`.

**First TTS call takes a long time**

The Kokoro model (~160 MB) is downloaded on first use and cached locally. Subsequent calls are fast.

---

## Security

- Session credentials are stored locally in `~/.telex/`. Treat them like passwords - they grant full access to your Telegram session.
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
2. Remove the plist: `rm ~/Library/LaunchAgents/com.telex.watcher.plist` (filename may vary - check `scripts/watcher-ctl.sh` for the exact name)
3. Run the uninstall command above to remove MCP config and auth
4. Optionally remove `~/.telex/` entirely: `rm -r ~/.telex/`

Restart Claude Code to apply.

---

## Requirements

- Node.js >= 18
- [AIBroker](https://www.npmjs.com/package/aibroker) daemon running (required)
- Telegram account with API credentials
- macOS with [iTerm2](https://iterm2.com/)
- [ffmpeg](https://ffmpeg.org/) for TTS voice note sending

---

## License

MIT - see [LICENSE](LICENSE)

## Author

Matthias Nott - [github.com/mnott](https://github.com/mnott)

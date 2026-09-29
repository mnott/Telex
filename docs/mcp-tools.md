# MCP tools

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

# telegram_status

Takes no parameters. Returns connection state, authenticated phone number, and adapter uptime.

# telegram_send

Sends a text message to your Saved Messages or any contact.

Parameters:
- `message` (required) - the text to send
- `recipient` (optional) - username, phone number, chat ID, or display name; omit for Saved Messages
- `voice` (optional, boolean) - if `true`, send as a TTS voice note instead of text

# telegram_tts

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

# telegram_send_file

Sends a file as a Telegram document, or optionally as inline formatted messages.

Parameters:
- `filePath` (required) - absolute path to the file
- `recipient` (optional) - username, phone number, chat ID, or display name; omit for Saved Messages
- `caption` (optional) - caption text to attach to the file
- `prettify` (optional, boolean) - if `true`, send the file contents as formatted inline Telegram messages rather than a document attachment; useful for markdown files you want to read in chat

# telegram_receive

Drains all messages buffered for the current session since the last call.

Parameters:
- `from` (optional) - omit for Saved Messages only, `"all"` for all sources, or a chat ID/name to filter

# telegram_wait

Efficient alternative to polling. Blocks until a message arrives or the timeout expires.

Parameters:
- `timeoutMs` (optional) - max wait in milliseconds; default 120000, max 300000

Use this when you want Claude to wait while you compose a reply:

```
"Wait for my next Telegram message before continuing."
```

# telegram_login

Takes no parameters. Triggers a fresh Telegram authentication flow. Use this if the session has expired or credentials have been revoked.

# telegram_contacts

Lists your Telegram contacts.

Parameters:
- `search` (optional) - filter by name or username
- `limit` (optional) - maximum results to return

# telegram_chats

Lists your Telegram chats (groups, channels, and direct messages).

Parameters:
- `search` (optional) - filter by chat name
- `limit` (optional, default 50) - maximum results to return

Chat IDs returned here can be passed directly to `telegram_history`.

# telegram_history

Fetches message history for a chat.

Parameters:
- `chatId` (required) - chat ID, username, or `'me'` for Saved Messages
- `count` (optional, default 20) - number of messages to return (most recent first)

# telegram_voice_config

Gets or sets the voice mode configuration. Configuration is persisted and survives adapter restarts.

Parameters:
- `action` (required) - `'get'` to read current config, `'set'` to update it
- `defaultVoice` (optional) - default voice name (e.g. `'bm_fable'`)
- `voiceMode` (optional, boolean) - `true` to enable automatic voice responses
- `localMode` (optional, boolean) - when `true` and `voiceMode` is `true`, use `telegram_speak` (Mac speakers) instead of `telegram_tts` (Telegram voice notes)
- `personas` (optional) - map of names to voice IDs (e.g. `{"Nicole": "af_nicole", "George": "bm_george"}`)

Default personas: Nicole -> `af_nicole`, George -> `bm_george`, Daniel -> `bm_daniel`, Fable -> `bm_fable`

# telegram_speak

Same TTS engine as `telegram_tts`, but plays audio through the Mac's speakers instead of sending a Telegram voice note. No Telegram connection required. Audio plays in the background without blocking other operations.

Parameters:
- `text` (required) - text to speak aloud
- `voice` (optional) - voice name (same list as `telegram_tts`); omit to use the configured default

# Install

## Alternative: npx

If you prefer a traditional install without cloning:

```bash
npx -y @tekmidian/telex setup
```

This will:
1. Add Telex to `~/.claude.json`
2. Print instructions for starting the adapter and authenticating
3. Credentials are saved to `~/.telex/auth/` on first authentication

Restart Claude Code. Telex connects automatically from now on.

## Manual install

```bash
git clone https://github.com/mnott/Telex.git
cd Telex
npm install
npm run build
```

Then tell Claude to set it up from the local clone.
## Prerequisites

- Node.js >= 18
- [AIBroker](https://github.com/mnott/AIBroker) running as a daemon (required - Telex will not function without it)
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

## Requirements

- Node.js >= 18
- [AIBroker](https://github.com/mnott/AIBroker) daemon running (required)
- Telegram account with API credentials
- macOS with [iTerm2](https://iterm2.com/)
- [ffmpeg](https://ffmpeg.org/) for TTS voice note sending

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

See the [AIBroker repo](https://github.com/mnott/AIBroker) for full MCP setup instructions.

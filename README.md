# Telex

Your phone is now a Claude Code terminal - via Telegram. Send a message to your Saved Messages, Claude gets it. Claude responds, you see it on Telegram. Text, images, voice notes - in both directions.

- Dictate a voice note while driving and Claude starts coding; send an image and Claude interprets it
- Get spoken responses back in any of 28 voices - synthesized locally, nothing leaves your machine
- Open and manage terminal sessions with `/t`, switch Claude sessions with `/s`, `/kill` a stuck one
- Take screenshots of any session with `/ss` and receive them on Telegram

One command to set up. Zero cloud dependencies for voice. Works with any Telegram account.

Telex is a thin adapter plugin for the [AIBroker](https://github.com/mnott/AIBroker) hub: it maintains the GramJS MTProto connection, the hub does the rest.

## Install

Tell Claude Code:

> Clone https://github.com/mnott/Telex and set it up for me

Or, without cloning:

```bash
npx -y @tekmidian/telex setup
```

Restart Claude Code. Telex connects automatically from now on. It needs the AIBroker hub running, Node.js >= 18 and Telegram API credentials.

Linux: see the Linux section in [Adapter daemon](docs/daemon.md#linux). The platform guides live in the [AIBroker](https://github.com/mnott/AIBroker) repo.

→ [docs/install.md](docs/install.md)

## How it works

Telex registers with the AIBroker hub over a Unix Domain Socket and passes messages in and out. Commands, sessions, TTS/STT, screenshots and all `telegram_*` MCP tools live in the hub. If AIBroker is not running, Telex will not function.

→ [docs/how-it-works.md](docs/how-it-works.md)

## How to use

Talk to Claude in plain language: send messages and voice notes, listen locally, switch on hands-free voice mode, take screenshots, manage sessions from your phone.

→ [docs/usage.md](docs/usage.md)

## MCP tools

The `telegram_*` tools (status, send, tts, send_file, receive, wait, login, contacts, chats, history, voice_config, speak), with parameters and the list of 28 voices. They are served by the AIBroker unified MCP server.

→ [docs/mcp-tools.md](docs/mcp-tools.md)

## Telegram commands

Messages starting with `/` are intercepted by the hub: session switching, screenshots and raw keyboard control of the active iTerm2 session.

→ [docs/commands.md](docs/commands.md)

## Best practices for CLAUDE.md

Rules to add to your `CLAUDE.md`: mirror every response to Telegram, acknowledge before long tasks, drain the queue at session start.

→ [docs/claude-md.md](docs/claude-md.md)

## Configuration

Environment variables (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEX_TTS_VOICE`) and where the daemon reads them from.

→ [docs/configuration.md](docs/configuration.md)

## Adapter daemon

Run the adapter manually, as a launchd agent on macOS, or as a systemd user unit on Linux.

→ [docs/daemon.md](docs/daemon.md)

## Troubleshooting

Hub not running, adapter not connected, authentication, iTerm2 prompts, ffmpeg and first-run TTS download.

→ [docs/troubleshooting.md](docs/troubleshooting.md)

## Security

Session credentials stay in `~/.telex/`; no data goes anywhere but Telegram's servers; TTS is fully local.

→ [docs/security.md](docs/security.md)

## Uninstall

Remove the MCP config, the auth data and the launchd agent.

→ [docs/uninstall.md](docs/uninstall.md)

## Credits

Built on [GramJS](https://github.com/gram-js/gramjs) for MTProto, [Kokoro-js](https://github.com/hexgrad/kokoro) for local TTS, [ffmpeg](https://ffmpeg.org/) for audio conversion and [Whisper](https://github.com/openai/whisper) for transcription. Runs on the [AIBroker](https://github.com/mnott/AIBroker) hub.

## Author

Matthias Nott - [github.com/mnott](https://github.com/mnott)

## License

MIT - see [LICENSE](LICENSE)

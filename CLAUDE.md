# Telex

Telegram MCP bridge for Claude Code — bidirectional self-chat via MTProto (gramjs).

## Build

```bash
npm install
npm run build    # tsc -> dist/
```

## Architecture

- `src/index.ts` — MCP server + tool definitions
- `src/watcher/` — Telegram connection, message handling, IPC
- `src/ipc-client.ts` — WatcherClient for socket communication
- Shared core: `aibroker` (logging, state, TTS, IPC, persistence)
- Watcher socket: `/tmp/telex-watcher.sock`
- Auth data: `~/.telex/session/`
- Credentials: `~/.telex/credentials` (TELEGRAM_API_ID, TELEGRAM_API_HASH)

## Key Rules

- dist/ is gitignored — always rebuild after pulling
- MCP schema loads at Claude Code session start — restart session after tool changes
- Never import gramjs in aibroker (hard boundary)
- npm package: `@tekmidian/telex` (scoped) — NOT `telex` (that's an unrelated package)
- Test with `telegram_status` tool after any watcher changes

# How it works

Telex is a thin **adapter plugin** for the [AIBroker](https://github.com/mnott/AIBroker) hub. It does one thing: maintain the GramJS MTProto connection to Telegram and pass messages in and out. All the intelligence - commands, session management, TTS/STT, screenshots, image generation, vision, and MCP tools - lives in the AIBroker daemon.

Telex registers with AIBroker on startup via a Unix Domain Socket. If AIBroker is not running, Telex will not function.

# Architecture

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

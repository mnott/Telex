# Security

- Session credentials are stored locally in `~/.telex/`. Treat them like passwords - they grant full access to your Telegram session.
- Telex reads and sends messages via your Saved Messages (self-chat) by default.
- No data is sent to any third-party service beyond Telegram's servers via MTProto.
- TTS synthesis is fully local (Kokoro-js runs on-device). Audio never leaves your machine.

# Troubleshooting

**"Hub not running" or connection refused errors**

The AIBroker daemon is not running. Start it first - Telex cannot function without it.

**"Adapter not connected" errors**

The Telex adapter is not running or has not registered with the hub. Start it with `node dist/index.js watch` or use `telex service start`.

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

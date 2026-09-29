# How to Use

Once Telex is set up, you talk to Claude in plain language. You never need to know about tool names or parameters - just say what you want.

# Sending Messages

Tell Claude what to say and to whom:

- "Send Alex a Telegram message saying I'll be late"
- "Tell Nicole on Telegram the meeting is moved to 3pm"
- "Message my Saved Messages: pick up milk"

If you don't say who to send it to, Claude sends to your Telegram Saved Messages - useful for notes to yourself.

# Voice Notes

Claude can send a Telegram voice note instead of a text message:

- "Send me a voice note saying good morning"
- "Send a voice note to Nicole saying I'm on my way"

You can choose whose voice to use:

- "Say it as George" or "Use George's voice"
- "Use Nicole's voice for this"

See the full voice list in the `telegram_tts` section of [MCP tools](mcp-tools.md#telegram_tts).

# Listening Locally (Mac Speakers)

Claude can speak out loud through your Mac - no Telegram needed:

- "Say that out loud"
- "Read that to me"

# Voice Mode - Hands-Free

Put Claude into persistent voice mode so every response comes back as audio automatically.

- "Voice mode on" - every Claude response becomes a Telegram voice note
- "Back to text" - back to normal text messages
- "Talk to me locally" - every response plays through your speakers

Voice mode is perfect for driving, cooking, or any time you can't look at a screen.

# Screenshots

Send `/ss` from your phone and the hub captures the active Claude session's iTerm2 window and sends it back to Telegram as an image.

# Session Management (from Your Phone)

Control your Claude sessions from Telegram:

- `/s` - see a list of your active Claude sessions
- `/2` - switch to session 2
- `/2 Cooking Project` - switch to session 2 and name it
- `/n` - create a new Claude session

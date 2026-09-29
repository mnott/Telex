# Telegram commands

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

# Keyboard control

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

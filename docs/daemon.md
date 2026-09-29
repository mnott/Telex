# Adapter daemon

Telex runs as a macOS launchd agent (`com.telex.watcher`) that starts automatically and restarts if it crashes. It requires the AIBroker hub daemon (`com.aibroker.daemon`) to be running first.

# Starting manually

```bash
node dist/index.js watch
```

# launchd setup (auto-start)

```bash
telex service start    # Install and start as launchd agent
telex service stop     # Stop and unload
telex service status   # Show running state
```

The agent uses `KeepAlive: true` and `ProcessType: Interactive`. The Interactive process type and `LimitLoadToSessionType: Aqua` are required so the adapter can access the macOS GUI session and call AppleScript to control iTerm2.

# Linux

`telex service` (a wrapper for `scripts/watcher-ctl.sh`, which git checkouts can run directly) detects Linux and manages a systemd **user** unit (`telex-watcher.service`) instead of launchd. No sudo is used.

Prerequisites: Node.js 18+, systemd with a user session (`systemctl --user` works), the AIBroker hub running, and Telegram credentials in `~/.telex/credentials` or the environment.

```bash
npm install -g @tekmidian/telex
telex service start    # write ~/.config/systemd/user/telex-watcher.service, enable --now
telex service status
telex service stop     # disable --now and remove the unit
telex service unit    # write the unit only, do not start it
```

The unit runs with `UMask=0077` and `Restart=on-failure`. It captures `PATH` and every `AIBROKER_*` / `TELEX_*` variable from the shell that runs `start`, plus the Telegram credentials. Output goes to `~/.local/state/telex/watch.log` (0600, in a 0700 directory); `journalctl --user -u telex-watcher` shows unit events.

By default a user service stops when you log out. To keep the watcher running, enable linger once: `loginctl enable-linger $USER` (`status` and `start` print this hint when linger is off). The `/ss` screenshot command needs macOS and iTerm2 and replies that it is unsupported on Linux.

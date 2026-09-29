# Uninstall

```bash
node dist/index.js uninstall
```

Or with npx from the published package:

```bash
npx -y @tekmidian/telex uninstall
```

This removes Telex from `~/.claude.json` and deletes credentials from `~/.telex/auth/`. To fully clean up:

1. Stop the launchd agent: `telex service stop`
2. Remove the plist: `rm ~/Library/LaunchAgents/com.telex.watcher.plist` (filename may vary - check `scripts/watcher-ctl.sh` in the package for the exact name)
3. Run the uninstall command above to remove MCP config and auth
4. Optionally remove `~/.telex/` entirely: `rm -r ~/.telex/`

Restart Claude Code to apply.

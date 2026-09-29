#!/usr/bin/env node
/**
 * Telex — Telegram adapter for AIBroker.
 *
 * This is a transport adapter, NOT an MCP server. All MCP tools are served
 * by the unified AIBroker MCP server (aibroker entry in ~/.claude.json).
 *
 * Entry points:
 *   - `watch [sessionId]` — Start the watcher daemon (gramjs connection,
 *     IPC server, message queues). Connects to AIBroker hub.
 *   - `setup` — Interactive setup wizard.
 *   - `uninstall` — Remove config and credentials.
 */

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case "setup": {
      const { setup } = await import("./setup.js");
      await setup();
      break;
    }
    case "uninstall": {
      const { uninstall } = await import("./setup.js");
      await uninstall();
      break;
    }
    case "watch": {
      const { watch } = await import("./watcher/index.js");
      await watch(process.argv[3]);
      break;
    }
    case "service": {
      const verbs: Record<string, string> = { start: "start", stop: "stop", status: "status", unit: "plist" };
      const verb = verbs[process.argv[3] ?? ""];
      if (!verb) {
        process.stderr.write("Usage: telex service {start [session-id]|stop|status|unit}\n");
        process.exit(1);
      }
      const { spawnSync } = await import("node:child_process");
      const { fileURLToPath } = await import("node:url");
      const script = fileURLToPath(new URL("../scripts/watcher-ctl.sh", import.meta.url));
      const r = spawnSync("bash", [script, verb, ...process.argv.slice(4)], { stdio: "inherit" });
      process.exit(r.status ?? 1);
      break;
    }
    default:
      process.stderr.write(
        "Telex is now an adapter for AIBroker.\n" +
        "MCP tools are served by the unified aibroker MCP server.\n\n" +
        "Usage:\n" +
        "  telex watch [sessionId]  — Start the watcher daemon\n" +
        "  telex service <verb>     — start [session-id] | stop | status | unit\n" +
        "  telex setup              — Run setup wizard\n" +
        "  telex uninstall          — Remove config\n"
      );
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[telex] Fatal error: ${err}\n`);
  process.exit(1);
});

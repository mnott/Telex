/**
 * watcher/index.ts — Telex watcher entry point.
 *
 * Thin transport adapter: connects to Telegram via gramjs, forwards all
 * messages to the AIBroker hub daemon for processing, and delivers hub
 * responses back via Telegram.
 *
 * Requires the AIBroker daemon to be running. Does not function standalone.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { setLogPrefix, log, WatcherClient, DAEMON_SOCKET_PATH, createBrokerMessage } from "aibroker";
import { setCommandHandler } from "./state.js";
import {
  loadSessionRegistry,
  loadStoreCache,
  loadVoiceConfig,
  saveStoreCache,
  saveSessionRegistry,
} from "./persistence.js";
import { createMessageHandler } from "./commands.js";
import { discoverSessions } from "./commands.js";
import { connectWatcher } from "./telegram.js";
import { startIpcServer, stopIpcServer, IPC_SOCKET_PATH } from "./ipc-server.js";
import { setAppDir } from "./persistence.js";

// ── Hub connection ──────────────────────────────────────────────────────────

/**
 * Connect to the AIBroker hub daemon. Retries up to 3 times with 2s timeout.
 * Throws if the hub is not reachable — adapter cannot function without it.
 */
async function connectToHub(): Promise<WatcherClient> {
  const client = new WatcherClient(DAEMON_SOCKET_PATH);
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await Promise.race([
        client.call_raw("status", {}),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 2000),
        ),
      ]);
      if (result !== null) return client;
    } catch {
      if (attempt < MAX_RETRIES) {
        log(`Hub not reachable (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
      }
    }
  }

  throw new Error(
    `AIBroker daemon not reachable at ${DAEMON_SOCKET_PATH}. ` +
    `Start it with: aibroker start`
  );
}

/**
 * Slash commands handled locally (require direct Telegram access).
 */
const LOCAL_SLASH_COMMANDS = new Set(["/restart", "/login"]);

function isLocalSlashCommand(text: string): boolean {
  return LOCAL_SLASH_COMMANDS.has(text.trim());
}

// ── Main loop ───────────────────────────────────────────────────────────────

export async function watch(rawSessionId?: string): Promise<void> {
  setLogPrefix("[telex]");
  setAppDir(join(homedir(), ".telex"));

  // Connect to AIBroker hub (required — no standalone mode)
  let hubClient: WatcherClient;
  try {
    hubClient = await connectToHub();
  } catch (err) {
    console.error(`[telex] FATAL: ${err instanceof Error ? err.message : String(err)}`);
    console.error("[telex] The AIBroker daemon must be running. Exiting.");
    process.exit(1);
  }

  console.log(`Telex Watch`);
  console.log(`  Socket:   ${IPC_SOCKET_PATH}`);
  console.log(`  Hub:      ${DAEMON_SOCKET_PATH}`);
  console.log();

  // Load persisted state
  loadSessionRegistry();
  loadStoreCache();
  loadVoiceConfig();

  let consecutiveFailures = 0;

  // Local handler for /restart and /login only
  const handler = createMessageHandler(
    () => null,
    () => {},
    () => consecutiveFailures,
    (n) => { consecutiveFailures = n; },
  );
  setCommandHandler(handler);

  // Connect to Telegram via MTProto
  const { cleanup, triggerLogin } = await connectWatcher(
    async (text: string, msgId: number, timestamp: number) => {
      // Local commands stay in the adapter
      if (isLocalSlashCommand(text)) {
        handler(text, msgId, timestamp);
        return;
      }

      // Everything else → hub
      const message = createBrokerMessage(
        "telex",
        text.trim().startsWith("/") ? "command" : "text",
        { text },
      );
      message.timestamp = timestamp;

      hubClient.call_raw("route_message", {
        message: message as unknown as Record<string, unknown>,
      }).catch((err) => {
        log(`Hub route_message failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  );

  // Start IPC server for MCP clients
  const ipcServer = startIpcServer(triggerLogin, hubClient);

  // Register with hub
  hubClient.call_raw("register_adapter", {
    name: "telex",
    socketPath: IPC_SOCKET_PATH,
  }).then(() => {
    log("Registered with AIBroker hub daemon");
  }).catch((err) => {
    log(`Hub registration failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Hub heartbeat — re-register if the daemon restarts
  const HUB_HEARTBEAT_INTERVAL = 30_000; // 30 seconds
  const heartbeatTimer = setInterval(async () => {
    try {
      const result = await Promise.race([
        hubClient.call_raw("status", {}),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5000),
        ),
      ]);
      if (result === null) throw new Error("null response");
    } catch {
      // Hub unreachable — try to re-register
      log("Hub heartbeat failed — attempting re-registration...");
      try {
        hubClient.call_raw("register_adapter", {
          name: "telex",
          socketPath: IPC_SOCKET_PATH,
        }).then(() => {
          log("Re-registered with AIBroker hub daemon");
        }).catch((err) => {
          log(`Hub re-registration failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      } catch {
        log("Hub still unreachable");
      }
    }
  }, HUB_HEARTBEAT_INTERVAL);

  // Discover existing sessions
  try {
    discoverSessions();
  } catch (err) {
    log("Initial session discovery failed:", String(err));
  }

  log("Telex watcher is running. Press Ctrl+C to stop.");

  // Graceful shutdown
  const shutdown = async () => {
    log("Shutting down...");
    clearInterval(heartbeatTimer);
    hubClient.call_raw("unregister_adapter", { name: "telex" }).catch(() => {});
    stopIpcServer();
    saveStoreCache();
    saveSessionRegistry();
    await cleanup();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => {});
}

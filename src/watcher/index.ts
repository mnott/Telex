import { join } from "node:path";
import { homedir } from "node:os";
import { setLogPrefix, setAppDir, log, router, APIBackend, HybridSessionManager, setHybridManager, snapshotAllSessions, startWsGateway, stopWsGateway, WatcherClient, DAEMON_SOCKET_PATH, createBrokerMessage } from "aibroker";
import { sessionRegistry } from "./state.js";
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
import {
  activeClientId,
  setActiveClientId,
} from "./state.js";

// ── Hub mode detection ───────────────────────────────────────────────────────

/**
 * Probe the AIBroker hub daemon to determine whether it is running.
 *
 * Connects to `/tmp/aibroker.sock` and calls `status`. If the call succeeds
 * within 2 seconds, the hub is considered alive and Telex enters hub mode.
 * On any failure (socket missing, refused, timeout), returns false and
 * Telex falls back to embedded mode (current behavior unchanged).
 */
async function detectHubMode(): Promise<boolean> {
  const client = new WatcherClient(DAEMON_SOCKET_PATH);
  try {
    const result = await Promise.race([
      client.call_raw("status", {}),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]);
    return result !== null;
  } catch {
    return false;
  }
}

/**
 * Slash commands that must be handled locally even in hub mode.
 *
 * These commands require direct iTerm2/Telegram access that only the Telex
 * process has. They should never be forwarded to the hub.
 */
const LOCAL_SLASH_COMMANDS = new Set([
  "/h", "/help",
  "/cc", "/esc", "/enter", "/tab",
  "/up", "/down", "/left", "/right",
  "/restart", "/login",
]);

/** Check if a message matches a local-only slash command. */
function isLocalSlashCommand(text: string): boolean {
  const trimmed = text.trim();
  if (LOCAL_SLASH_COMMANDS.has(trimmed)) return true;
  if (/^\/pick\s+\d+/.test(trimmed)) return true;
  return false;
}

// ── Main loop ────────────────────────────────────────────────────────────────

export async function watch(rawSessionId?: string): Promise<void> {
  // Initialize shared AIBroker settings
  setLogPrefix("[telex]");
  setAppDir(join(homedir(), ".telex"));

  // Always-hybrid startup: APIBackend for headless + visual sessions via iTerm2
  const apiBackend = new APIBackend({
    type: "api",
    provider: "anthropic",
    model: process.env.AIBROKER_MODEL ?? "sonnet",
    cwd: process.env.AIBROKER_CWD,
    maxTurns: Number(process.env.AIBROKER_MAX_TURNS) || 30,
    maxBudgetUsd: Number(process.env.AIBROKER_MAX_BUDGET) || 1.0,
    permissionMode: process.env.AIBROKER_PERMISSION_MODE ?? "acceptEdits",
    skipDefaultSession: true,
  });
  const manager = new HybridSessionManager(apiBackend);
  setHybridManager(manager);
  manager.createApiSession("Default", process.env.AIBROKER_CWD ?? homedir());
  router.setDefaultBackend(apiBackend);

  // ── Detect hub mode ──
  let hubMode = await detectHubMode();
  const hubClient = hubMode ? new WatcherClient(DAEMON_SOCKET_PATH) : null;
  let hubFailures = 0;
  const HUB_FAILURE_THRESHOLD = 3;

  console.log(`Telex Watch`);
  console.log(`  Backend:  hybrid (api=${apiBackend.model})`);
  console.log(`  Socket:   ${IPC_SOCKET_PATH}`);
  console.log(`  Mode:     ${hubMode ? "hub (daemon detected)" : "embedded (standalone)"}`);
  console.log();

  // Load persisted state
  loadSessionRegistry();
  loadStoreCache();
  loadVoiceConfig();

  // Track delivery failures for fallback logic
  let consecutiveFailures = 0;

  // Create message handler
  const handler = createMessageHandler(
    () => activeClientId,
    (id) => setActiveClientId(id),
    () => consecutiveFailures,
    (n) => { consecutiveFailures = n; },
  );

  setCommandHandler(handler);

  // Connect to Telegram via MTProto
  const { cleanup, triggerLogin } = await connectWatcher(
    async (text: string, msgId: number, timestamp: number) => {
      if (hubMode && hubClient) {
        // Hub mode: forward non-local messages to the hub for routing.
        // Local slash commands (keyboard, /restart, /help) stay in Telex.
        if (isLocalSlashCommand(text)) {
          handler(text, msgId, timestamp);
          return;
        }

        // Create a BrokerMessage and route through the hub
        const message = createBrokerMessage(
          "telex",
          text.trim().startsWith("/") ? "command" : "text",
          { text },
        );
        message.timestamp = timestamp;

        hubClient.call_raw("route_message", {
          message: message as unknown as Record<string, unknown>,
        }).then(() => {
          hubFailures = 0;
        }).catch((err) => {
          hubFailures++;
          log(`Hub route_message failed (${hubFailures}/${HUB_FAILURE_THRESHOLD}), falling back to local: ${err instanceof Error ? err.message : String(err)}`);
          handler(text, msgId, timestamp);
          if (hubFailures >= HUB_FAILURE_THRESHOLD) {
            log("Hub unreachable — switching to embedded mode permanently for this session");
            hubMode = false;
          }
        });
      } else {
        // Embedded mode: handle everything locally (unchanged)
        handler(text, msgId, timestamp);
      }
    }
  );

  // Start IPC server for MCP clients
  const ipcServer = startIpcServer(triggerLogin);

  if (hubMode && hubClient) {
    // Hub mode: do NOT start PAILot WsGateway — the hub owns it.
    // Register with the hub so it can route messages to us.
    log("Hub mode: skipping WsGateway (hub owns PAILot gateway)");
    hubClient.call_raw("register_adapter", {
      name: "telex",
      socketPath: IPC_SOCKET_PATH,
    }).then(() => {
      log("Registered with AIBroker hub daemon");
    }).catch((err) => {
      log(`Hub registration failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  } else {
    // Embedded mode: start WsGateway locally (current behavior)
    // Gateway uses 2-arg (text, timestamp), Telex handler uses 3-arg (text, msgId, timestamp)
    startWsGateway((text, timestamp) => handler(text, 0, timestamp));
    log("Embedded mode: started local WsGateway");
  }

  // Discover existing sessions and register them as visual sessions
  try {
    discoverSessions();
  } catch (err) {
    log("Initial session discovery failed:", String(err));
  }

  // Register discovered iTerm2 sessions in HybridSessionManager
  const liveSnapshots = snapshotAllSessions();
  const snapById = new Map(liveSnapshots.map(s => [s.id, s]));
  for (const [, entry] of sessionRegistry) {
    if (entry.itermSessionId) {
      const snap = snapById.get(entry.itermSessionId);
      const displayName = snap?.tabTitle ?? snap?.profileName ?? snap?.paiName ?? entry.name;
      manager.registerVisualSession(displayName, "", entry.itermSessionId);
    }
  }

  log("Telex watcher is running. Press Ctrl+C to stop.");

  // Graceful shutdown
  const shutdown = async () => {
    log("Shutting down...");
    if (!hubMode) stopWsGateway();
    // Unregister from hub on shutdown
    if (hubClient) {
      hubClient.call_raw("unregister_adapter", { name: "telex" }).catch(() => {});
    }
    stopIpcServer();
    saveStoreCache();
    saveSessionRegistry();
    await cleanup();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Suspend forever
  await new Promise(() => {});
}

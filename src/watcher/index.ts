import { join } from "node:path";
import { homedir } from "node:os";
import { setLogPrefix, setAppDir, log } from "aibroker";
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
import { startIpcServer, stopIpcServer } from "./ipc-server.js";
import {
  activeClientId,
  setActiveClientId,
} from "./state.js";

export async function watch(rawSessionId?: string): Promise<void> {
  // Initialize shared AIBroker settings
  setLogPrefix("[telex]");
  setAppDir(join(homedir(), ".telex"));

  log("Starting Telex watcher...");

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
  const { cleanup, triggerLogin } = await connectWatcher(handler);

  // Start IPC server for MCP clients
  const ipcServer = startIpcServer(triggerLogin);

  // Discover existing sessions
  try {
    await discoverSessions();
  } catch (err) {
    log("Initial session discovery failed:", String(err));
  }

  log("Telex watcher is running. Press Ctrl+C to stop.");

  // Graceful shutdown
  const shutdown = async () => {
    log("Shutting down...");
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

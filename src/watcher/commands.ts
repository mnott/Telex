/**
 * commands.ts — Thin adapter-local command handler.
 *
 * Only handles commands that require direct Telegram access (/restart, /login).
 * All other commands are forwarded to the AIBroker hub daemon via route_message.
 */

import { log } from "./log.js";
import type { MessageHandler } from "./types.js";

// Re-export discoverSessions for backward compat (used by index.ts)
export { discoverSessions } from "./discover.js";

/**
 * Create the local message handler for adapter-specific commands.
 */
export function createMessageHandler(
  _getActive: () => string | null,
  _setActive: (id: string | null) => void,
  _getFailures: () => number,
  _setFailures: (n: number) => void,
): MessageHandler {

  async function handleMessage(
    text: string,
    _msgId: number,
    _timestamp: number,
  ): Promise<void> {
    const trimmedText = text.trim();

    if (trimmedText === "/restart") {
      log("/restart: watcher restart requested via Telegram");
      const { watcherClient } = await import("./state.js");
      if (watcherClient) {
        await watcherClient.sendMessage("me", { message: "Restarting Telex watcher..." });
      }
      setTimeout(() => process.exit(0), 500);
      return;
    }

    if (trimmedText === "/login") {
      const { watcherClient } = await import("./state.js");
      if (watcherClient) {
        await watcherClient.sendMessage("me", { message: "Use the login flow — handled by the watcher." });
      }
      return;
    }

    // Everything else should have gone to the hub
    log(`commands.ts: unexpected message received locally: ${trimmedText.slice(0, 60)}`);
  }

  return handleMessage;
}

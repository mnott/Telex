/**
 * discover.ts — iTerm2 session discovery for Telex.
 *
 * Extracted from commands.ts during adapter stripping.
 */

import {
  sessionRegistry,
  clientQueues,
  clientWaiters,
} from "./state.js";
import { saveSessionRegistry } from "./persistence.js";
import { log } from "./log.js";
import { snapshotAllSessions, hybridManager } from "aibroker";

export function discoverSessions(): void {
  try {
    const snapshot = snapshotAllSessions();

    if (snapshot.length === 0 && sessionRegistry.size > 0) {
      return;
    }

    const liveIds = new Set(snapshot.map((s) => s.id));

    // Prune dead sessions
    for (const [sid, entry] of sessionRegistry) {
      if (entry.itermSessionId && !liveIds.has(entry.itermSessionId)) {
        sessionRegistry.delete(sid);
        clientQueues.delete(sid);
        clientWaiters.delete(sid);
      }
    }

    // Discover sessions with paiName and register as visual sessions
    for (const s of snapshot) {
      if (s.paiName && !findByItermId(s.id)) {
        const syntheticId = `discovered-${s.id}`;
        sessionRegistry.set(syntheticId, {
          sessionId: syntheticId,
          name: s.paiName,
          itermSessionId: s.id,
          registeredAt: Date.now(),
        });
        const displayName = s.tabTitle ?? s.profileName ?? s.paiName;
        hybridManager?.registerVisualSession(displayName, "", s.id);
      }
    }

    saveSessionRegistry();
  } catch (err) {
    log("Discover error:", String(err));
  }
}

function findByItermId(itermId: string): boolean {
  for (const entry of sessionRegistry.values()) {
    if (entry.itermSessionId === itermId) return true;
  }
  return false;
}

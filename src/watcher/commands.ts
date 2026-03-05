import {
  sessionRegistry,
  activeClientId,
  activeItermSessionId,
  setActiveClientId,
  setActiveItermSessionId,
  clientQueues,
  clientWaiters,
  dispatchIncomingMessage,
} from "./state.js";
import { startTypingIndicator, stopTypingIndicator } from "./typing.js";
import { saveSessionRegistry } from "./persistence.js";
import { log } from "./log.js";
import { router, deliverViaApi, hybridManager } from "aibroker";
import type { HybridSession } from "aibroker";
import { watcherSendMessage, watcherSendVoiceNote } from "./send.js";
import type { MessageHandler } from "./types.js";
import {
  typeIntoSession,
  sendKeystrokeToSession,
  sendEscapeSequenceToSession,
  snapshotAllSessions,
  findClaudeSession,
  isScreenLocked,
  writeToTty,
  stripItermPrefix,
} from "./iterm-core.js";

// ── iTerm Integration (lazy import for session management) ──

async function getItermSessions() {
  return import("./iterm-sessions.js");
}

// ── Message Handler Factory ──

export function createMessageHandler(
  getActive: () => string | null,
  setActive: (id: string | null) => void,
  getFailures: () => number,
  setFailures: (n: number) => void,
): MessageHandler {
  async function handleMessage(
    text: string,
    msgId: number,
    timestamp: number,
  ): Promise<void> {
    ensureActiveSession();

    const trimmedText = text.trim();

    if (trimmedText.startsWith("/")) {
      await handleSlashCommand(trimmedText, text);
      return;
    }

    // Prefix message based on type
    let textToDeliver: string;
    if (
      trimmedText.startsWith("[Voice note]") ||
      trimmedText.startsWith("[Audio]")
    ) {
      textToDeliver = `[Telex:voice] ${text}`;
    } else {
      textToDeliver = `[Telex] ${text}`;
    }

    // Route based on active session kind
    const activeHybrid = hybridManager?.activeSession;
    if (activeHybrid?.kind === "api") {
      deliverViaApi(hybridManager!.apiBackend, textToDeliver, activeHybrid.backendSessionId, {
        sendText: (text) => watcherSendMessage(text).then(() => {}),
        sendVoice: (buffer) => watcherSendVoiceNote(buffer).then(() => {}),
      });
      return;
    }

    // Visual session or no hybrid manager — deliver to iTerm2
    const delivered = deliverMessage(textToDeliver);

    if (delivered) {
      startTypingIndicator("me");
    }

    // Dispatch to IPC queue for MCP clients
    dispatchIncomingMessage(textToDeliver, timestamp);
  }

  return handleMessage;
}

// ── Session Management ──

function ensureActiveSession(): void {
  if (activeClientId && sessionRegistry.has(activeClientId)) return;

  // Try to find any registered session
  const sessions = Array.from(sessionRegistry.values());
  if (sessions.length > 0) {
    setActiveClientId(sessions[0].sessionId);
    if (sessions[0].itermSessionId) {
      setActiveItermSessionId(sessions[0].itermSessionId);
    }
    return;
  }

  // No sessions — try to discover
  try {
    discoverSessions();
  } catch (err) {
    log("Failed to discover sessions:", String(err));
  }
}

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
        // Register in HybridSessionManager so /s shows visual sessions
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

// ── Message Delivery (AppleScript → iTerm) ──

function deliverMessage(text: string): boolean {
  try {
    // Try typing into active session
    if (activeItermSessionId) {
      const success = typeIntoSession(activeItermSessionId, text);
      if (success) return true;
    }

    // Screen locked? Try PTY fallback
    if (isScreenLocked()) {
      const activeEntry = activeClientId ? sessionRegistry.get(activeClientId) : undefined;
      // Find tty from snapshot
      const snapshot = snapshotAllSessions();
      const targetId = stripItermPrefix(activeItermSessionId ?? activeEntry?.itermSessionId);
      const session = targetId ? snapshot.find(s => s.id === targetId) : snapshot[0];
      if (session?.tty) {
        return writeToTty(session.tty, text);
      }
    }

    // Fallback: find any Claude session
    const claude = findClaudeSession();
    if (claude) {
      return typeIntoSession(claude, text);
    }

    log("No Claude session found for message delivery");
    return false;
  } catch (err) {
    log("Delivery failed:", String(err));
    return false;
  }
}

// ── Slash Commands ──

async function handleSlashCommand(trimmedText: string, originalText: string): Promise<void> {
  const [cmd, ...args] = trimmedText.split(/\s+/);
  const arg = args.join(" ");

  // Guard for keyboard commands that need a visual session
  const kbCommands = ["/cc", "/esc", "/enter", "/tab", "/up", "/down", "/left", "/right", "/p"];
  const needsVisual = kbCommands.includes(cmd.toLowerCase());
  if (needsVisual) {
    if (hybridManager?.activeSession?.kind === "api") {
      await sendToTelegram("Keyboard commands need a visual session. Use /nv to create one.");
      return;
    }
    ensureActiveSession();
    if (!activeItermSessionId) {
      await sendToTelegram("No active session.");
      return;
    }
  }

  switch (cmd.toLowerCase()) {
    case "/h":
    case "/help":
      await sendToTelegram(formatHelp());
      break;

    case "/s":
    case "/sessions": {
      if (hybridManager) {
        await sendToTelegram(hybridManager.formatSessionList());
        break;
      }
      ensureActiveSession();
      await sendToTelegram(formatSessions());
      break;
    }

    case "/nh": {
      if (!arg) {
        await sendToTelegram("Usage: /nh <path>");
        break;
      }
      if (hybridManager) {
        const { basename } = await import("node:path");
        const name = basename(arg);
        const session = hybridManager.createApiSession(name, arg);
        log(`/nh: created API session "${session.name}" (${session.id}) cwd=${session.cwd}`);
        await sendToTelegram(`New headless session: *${session.name}* (${session.cwd})`);
        break;
      }
      break;
    }

    case "/n":
    case "/nv":
    case "/new": {
      if (!arg) {
        await sendToTelegram("Usage: /n <path>");
        break;
      }
      if (hybridManager) {
        try {
          const sessions = await getItermSessions();
          const itermId = await sessions.createClaudeSession(arg);
          if (itermId) {
            const { basename } = await import("node:path");
            const name = basename(arg);
            hybridManager.registerVisualSession(name, arg, itermId);
            setActiveItermSessionId(itermId);
            log(`/n: created visual session "${name}" (iTerm2=${itermId})`);
            await sendToTelegram(`New visual session: *${name}* (${arg})`);
          }
        } catch (err) {
          await sendToTelegram(`Error: ${err}`);
        }
        break;
      }
      try {
        const sessions = await getItermSessions();
        await sessions.createClaudeSession();
        await sendToTelegram("New Claude session created");
      } catch (err) {
        await sendToTelegram(`Error: ${err}`);
      }
      break;
    }

    case "/ss":
    case "/screenshot": {
      if (hybridManager) {
        const status = hybridManager.formatActiveStatus();
        if (status !== null) {
          await sendToTelegram(status);
          break;
        }
        // Visual session — fall through to screenshot
      }
      try {
        const { handleScreenshot } = await import("./screenshot.js");
        await handleScreenshot();
      } catch (err) {
        log(`/ss: unhandled error — ${err}`);
      }
      break;
    }

    case "/c": {
      if (hybridManager?.activeSession?.kind === "api") {
        hybridManager.clearActiveSession();
        log("/c: cleared API session conversation history");
        await sendToTelegram("Session cleared.");
        break;
      }
      // Visual session — clear + go
      ensureActiveSession();
      if (!activeItermSessionId) {
        await sendToTelegram("No active session.");
        break;
      }
      try {
        await sendToTelegram("Clearing context...");
        await new Promise(r => setTimeout(r, 10_000));
        typeIntoSession(activeItermSessionId, "/clear");
        await new Promise(r => setTimeout(r, 8_000));
        typeIntoSession(activeItermSessionId, "go");
        await sendToTelegram("Context cleared, resuming.");
      } catch {
        // ignore
      }
      break;
    }

    case "/cc":
      sendKeystrokeToSession(activeItermSessionId, 3); // Ctrl+C
      break;

    case "/esc":
      sendKeystrokeToSession(activeItermSessionId, 27);
      break;

    case "/enter":
      sendKeystrokeToSession(activeItermSessionId, 13);
      break;

    case "/tab":
      sendKeystrokeToSession(activeItermSessionId, 9);
      break;

    case "/up":
      sendEscapeSequenceToSession(activeItermSessionId, "A");
      break;

    case "/down":
      sendEscapeSequenceToSession(activeItermSessionId, "B");
      break;

    case "/left":
      sendEscapeSequenceToSession(activeItermSessionId, "D");
      break;

    case "/right":
      sendEscapeSequenceToSession(activeItermSessionId, "C");
      break;

    case "/p":
      typeIntoSession(activeItermSessionId, "pause session");
      break;

    case "/pick": {
      // /pick N [text] — navigate down N-1 items, press Enter, optionally type text
      const pickMatch = trimmedText.match(/^\/pick\s+(\d+)(?:\s+(.+))?$/i);
      if (pickMatch) {
        const count = parseInt(pickMatch[1], 10);
        const pickText = pickMatch[2];
        for (let i = 1; i < count; i++) {
          sendEscapeSequenceToSession(activeItermSessionId, "B");
          await new Promise(r => setTimeout(r, 100));
        }
        sendKeystrokeToSession(activeItermSessionId, 13);
        if (pickText) {
          await new Promise(r => setTimeout(r, 500));
          typeIntoSession(activeItermSessionId, pickText);
        }
      } else {
        await sendToTelegram("Usage: /pick N [text]");
      }
      break;
    }

    case "/restart":
      try {
        await sendToTelegram("Restarting watcher...");
        setTimeout(() => process.exit(0), 500);
      } catch {
        process.exit(0);
      }
      break;

    case "/e":
    case "/end": {
      const num = parseInt(arg, 10);
      if (!num) {
        await sendToTelegram("Usage: /e N");
        break;
      }
      if (hybridManager) {
        const session = hybridManager.getByIndex(num);
        if (!session) {
          const count = hybridManager.listSessions().length;
          await sendToTelegram(`Invalid session number. Use /s to list (1-${count}).`);
          break;
        }
        hybridManager.removeByIndex(num);
        log(`/e: ended ${session.kind} session "${session.name}" (${session.id})`);
        await sendToTelegram(`Ended session *${session.name}*.`);
        break;
      }
      await sendToTelegram(`Unknown command: ${cmd}`);
      break;
    }

    default:
      // Try numeric session switch: /1, /2 name, etc.
      if (/^\/\d+/.test(cmd)) {
        const num = parseInt(cmd.slice(1), 10);
        if (hybridManager) {
          const session = hybridManager.switchToIndex(num);
          if (!session) {
            const count = hybridManager.listSessions().length;
            await sendToTelegram(`Invalid session number. Use /s to list (1-${count}).`);
          } else {
            if (session.kind === "visual") {
              setActiveItermSessionId(session.backendSessionId);
            }
            const tag = session.kind === "api" ? " [api]" : " [visual]";
            log(`/N: switched to ${session.kind} session "${session.name}" (${session.id})`);
            await sendToTelegram(`Switched to *${session.name}*${tag}`);
          }
          break;
        }
        const idx = num - 1;
        const sessions = Array.from(sessionRegistry.values());
        if (idx >= 0 && idx < sessions.length) {
          const session = sessions[idx];
          setActiveClientId(session.sessionId);
          if (session.itermSessionId) {
            setActiveItermSessionId(session.itermSessionId);
          }
          if (arg) {
            session.name = arg;
            saveSessionRegistry();
          }
          await sendToTelegram(
            `Switched to session ${idx + 1}: ${session.name}`,
          );
        }
      } else {
        await sendToTelegram(`Unknown command: ${cmd}`);
      }
  }
}

function formatHelp(): string {
  return [
    "\uFEFF*Telex Commands*",
    "",
    "/h — Help",
    "/s — List sessions",
    "/N [name] — Switch to session N",
    "/n <path> — New visual session (iTerm2)",
    "/nh <path> — New headless session",
    "/e N — End session N",
    "/c — Clear context + go",
    "/cc — Ctrl+C",
    "/esc — Escape",
    "/enter — Enter",
    "/tab — Tab",
    "/up /down /left /right — Arrows",
    "/p — Pause session",
    "/pick N [text] — Pick menu item N",
    "/ss — Screenshot",
    "/restart — Restart watcher",
  ].join("\n");
}

function formatSessions(): string {
  const sessions = Array.from(sessionRegistry.values());
  if (sessions.length === 0) return "\uFEFFNo active sessions";

  const lines = sessions.map((s, i) => {
    const active = s.sessionId === activeClientId ? " ●" : "";
    return `${i + 1}. ${s.name}${active}`;
  });
  return "\uFEFF" + lines.join("\n");
}

async function sendToTelegram(text: string): Promise<void> {
  try {
    const { watcherClient } = await import("./state.js");
    if (watcherClient) {
      await watcherClient.sendMessage("me", { message: text });
    }
  } catch (err) {
    log("Failed to send command response:", String(err));
  }
}

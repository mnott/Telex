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
import { router, APIBackend, deliverViaApi } from "aibroker";
import type { APISession } from "aibroker";
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

    // Check if router has an API backend — if so, deliver via subprocess
    // and send the response directly back to Telegram (no iTerm2 needed).
    const backend = router.defaultBackend;
    if (backend instanceof APIBackend) {
      deliverViaApi(backend, textToDeliver, backend.activeSessionId, {
        sendText: (text) => watcherSendMessage(text).then(() => {}),
        sendVoice: (buffer) => watcherSendVoiceNote(buffer).then(() => {}),
      });
      return;
    }

    // Deliver to active Claude session
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

    // Discover sessions with paiName
    for (const s of snapshot) {
      if (s.paiName && !findByItermId(s.id)) {
        const syntheticId = `discovered-${s.id}`;
        sessionRegistry.set(syntheticId, {
          sessionId: syntheticId,
          name: s.paiName,
          itermSessionId: s.id,
          registeredAt: Date.now(),
        });
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

  // Guard for commands that need an active iTerm2 session (skip in API mode)
  const needsSession = ["/c", "/cc", "/esc", "/enter", "/tab", "/up", "/down", "/left", "/right", "/p"].includes(cmd.toLowerCase());
  if (needsSession && !(router.defaultBackend instanceof APIBackend)) {
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
      const backend = router.defaultBackend;
      if (backend instanceof APIBackend) {
        const sessions = backend.listSessions();
        if (sessions.length === 0) {
          await watcherSendMessage("No API sessions. Use /n <path> to create one.");
          break;
        }
        const lines = sessions.map((s: APISession, i: number) => {
          const isActive = s.id === backend.activeSessionId;
          const cwdDisplay = s.cwd ? ` (${s.cwd})` : "";
          return `${isActive ? "*" : " "}${i + 1}. ${s.name}${cwdDisplay}`;
        });
        await watcherSendMessage(lines.join("\n"));
        break;
      }
      ensureActiveSession();
      await sendToTelegram(formatSessions());
      break;
    }

    case "/n":
    case "/new": {
      const backend = router.defaultBackend;
      if (backend instanceof APIBackend) {
        if (!arg) {
          await watcherSendMessage("Usage: /n <path>");
          break;
        }
        const { basename } = await import("node:path");
        const name = basename(arg);
        const session = backend.createSession(name, arg);
        log(`/n API mode: created session "${session.name}" (${session.id}) cwd=${session.cwd}`);
        await watcherSendMessage(`New session: *${session.name}* (${session.cwd})`);
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
      const ssBackend = router.defaultBackend;
      if (ssBackend instanceof APIBackend) {
        await watcherSendMessage(ssBackend.formatStatus());
        break;
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
      const backend = router.defaultBackend;
      if (backend instanceof APIBackend) {
        backend.clearSession();
        log("/c API mode: cleared active session conversation history");
        await watcherSendMessage("Session cleared.");
        break;
      }
      // Clear + go (like Whazaa): wait, type /clear, wait, type go
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
      const backend = router.defaultBackend;
      if (backend instanceof APIBackend) {
        const num = parseInt(arg, 10);
        if (!num) {
          await watcherSendMessage("Usage: /e N");
          break;
        }
        const session = backend.getSessionByIndex(num);
        if (!session) {
          const count = backend.listSessions().length;
          await watcherSendMessage(`Invalid session number. Use /s to list (1-${count}).`);
          break;
        }
        const ended = backend.endSession(session.id);
        if (ended) {
          log(`/e API mode: ended session "${session.name}" (${session.id})`);
          await watcherSendMessage(`Ended session *${session.name}*.`);
        } else {
          await watcherSendMessage("Failed to end session.");
        }
        break;
      }
      await sendToTelegram(`Unknown command: ${cmd}`);
      break;
    }

    default:
      // Try numeric session switch: /1, /2 name, etc.
      if (/^\/\d+/.test(cmd)) {
        const num = parseInt(cmd.slice(1), 10);
        const backend = router.defaultBackend;
        if (backend instanceof APIBackend) {
          const session = backend.getSessionByIndex(num);
          if (!session) {
            const count = backend.listSessions().length;
            await watcherSendMessage(`Invalid session number. Use /s to list (1-${count}).`);
          } else {
            backend.activeSessionId = session.id;
            log(`/N API mode: switched active session to "${session.name}" (${session.id})`);
            await watcherSendMessage(`Switched to *${session.name}*`);
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
    "/n <path> — New Claude session in directory",
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

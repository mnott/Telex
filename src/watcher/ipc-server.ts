import * as net from "node:net";
import { unlinkSync, existsSync } from "node:fs";
import { log } from "./log.js";
import {
  sessionRegistry,
  activeClientId,
  activeItermSessionId,
  setActiveClientId,
  setActiveItermSessionId,
  clientQueues,
  clientWaiters,
  contactMessageQueues,
  contactDirectory,
  chatStore,
  watcherClient,
  watcherStatus,
  voiceConfig,
  setVoiceConfig,
  adapterStats,
} from "./state.js";
import {
  saveSessionRegistry,
  saveVoiceConfig,
  saveStoreCache,
} from "./persistence.js";
import { watcherSendMessage, watcherSendFile, watcherSendVoiceNote } from "./send.js";
import { resolveRecipient, getContacts, markdownToTelegram } from "./contacts.js";
import { startTypingIndicator, stopTypingIndicator } from "./typing.js";
import { discoverSessions } from "./commands.js";
import { setItermSessionVar, setItermTabName } from "./iterm-sessions.js";
import type { IpcRequest, IpcResponse, QueuedMessage } from "./types.js";

export const IPC_SOCKET_PATH = "/tmp/telex-watcher.sock";
let server: net.Server | null = null;
let triggerLoginFn: (() => Promise<void>) | null = null;

export function startIpcServer(
  triggerLogin: () => Promise<void>,
): net.Server {
  triggerLoginFn = triggerLogin;

  // Clean up stale socket
  if (existsSync(IPC_SOCKET_PATH)) {
    try {
      unlinkSync(IPC_SOCKET_PATH);
    } catch {
      // ignore
    }
  }

  server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        handleRequest(socket, line);
      }
    });

    socket.on("error", () => {
      // Client disconnected — ignore
    });
  });

  server.listen(IPC_SOCKET_PATH, () => {
    log(`IPC server listening on ${IPC_SOCKET_PATH}`);
  });

  server.on("error", (err) => {
    log("IPC server error:", String(err));
  });

  return server;
}

export function stopIpcServer(): void {
  if (server) {
    server.close();
    server = null;
  }
  if (existsSync(IPC_SOCKET_PATH)) {
    try {
      unlinkSync(IPC_SOCKET_PATH);
    } catch {
      // ignore
    }
  }
}

// ── Request Router ──

async function handleRequest(
  socket: net.Socket,
  line: string,
): Promise<void> {
  let request: IpcRequest;
  try {
    request = JSON.parse(line);
  } catch {
    sendResponse(socket, { id: "?", ok: false, error: "Invalid JSON" });
    return;
  }

  const { id, sessionId, itermSessionId, method, params } = request;

  // Auto-register unknown sessions
  if (sessionId && !sessionRegistry.has(sessionId)) {
    sessionRegistry.set(sessionId, {
      sessionId,
      name: `Session-${sessionRegistry.size + 1}`,
      itermSessionId,
      registeredAt: Date.now(),
    });
    if (!clientQueues.has(sessionId)) clientQueues.set(sessionId, []);
    if (!clientWaiters.has(sessionId)) clientWaiters.set(sessionId, []);
  }

  const respond = (result: Record<string, unknown>) =>
    sendResponse(socket, { id, ok: true, result });
  const respondError = (error: string) =>
    sendResponse(socket, { id, ok: false, error });

  try {
    switch (method) {
      case "register":
        await handleRegister(sessionId, itermSessionId, params, respond);
        break;
      case "rename":
        await handleRename(sessionId, params, respond);
        break;
      case "status":
        respond({
          connected: watcherStatus.connected,
          phoneNumber: watcherStatus.phoneNumber,
          awaitingCode: watcherStatus.awaitingCode,
        });
        break;
      case "send":
        await handleSend(params, respond, respondError);
        break;
      case "send_file":
        await handleSendFile(params, respond, respondError);
        break;
      case "receive":
        handleReceive(sessionId, params, respond);
        break;
      case "wait":
        handleWait(socket, sessionId, params, id);
        return; // Don't close socket yet — long-poll
      case "login":
        await handleLogin(respond, respondError);
        break;
      case "contacts":
        handleContacts(params, respond);
        break;
      case "chats":
        handleChats(params, respond);
        break;
      case "history":
        await handleHistory(params, respond, respondError);
        break;
      case "tts":
        await handleTts(params, respond, respondError);
        break;
      case "speak":
        await handleSpeak(params, respond, respondError);
        break;
      case "voice_config":
        handleVoiceConfig(params, respond);
        break;
      case "command":
        await handleCommand(params, respond);
        break;
      case "discover":
        await handleDiscover(respond);
        break;
      case "sessions":
        handleSessions(sessionId, respond);
        break;
      case "switch":
        await handleSwitch(params, respond, respondError);
        break;
      case "end_session":
        await handleEndSession(params, respond, respondError);
        break;
      case "health":
        handleHealth(respond);
        break;
      case "connection_status":
        handleConnectionStatus(respond);
        break;
      case "deliver":
        await handleDeliver(socket, id, params);
        return; // handleDeliver writes its own response
      default:
        respondError(`Unknown method: ${method}`);
    }
  } catch (err) {
    respondError(String(err));
  }
}

function sendResponse(socket: net.Socket, response: IpcResponse): void {
  try {
    socket.write(JSON.stringify(response) + "\n");
    socket.end();
  } catch {
    // socket already closed
  }
}

// ── Method Handlers ──

async function handleRegister(
  sessionId: string,
  itermSessionId: string | undefined,
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
): Promise<void> {
  const entry = sessionRegistry.get(sessionId)!;

  if (itermSessionId) {
    entry.itermSessionId = itermSessionId;
  }

  // Set as active if it's the only session or first to register
  if (!activeClientId || sessionRegistry.size === 1) {
    setActiveClientId(sessionId);
    if (entry.itermSessionId) {
      setActiveItermSessionId(entry.itermSessionId);
    }
  }

  if (!clientQueues.has(sessionId)) clientQueues.set(sessionId, []);
  if (!clientWaiters.has(sessionId)) clientWaiters.set(sessionId, []);

  // Persist iTerm name if available
  if (entry.itermSessionId && entry.name) {
    try {
      await setItermSessionVar(entry.itermSessionId, entry.name);
      await setItermTabName(entry.itermSessionId, entry.name);
    } catch {
      // best effort
    }
  }

  saveSessionRegistry();
  respond({ sessionId, name: entry.name });
}

async function handleRename(
  sessionId: string,
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
): Promise<void> {
  const name = String(params.name ?? "");
  if (!name) return respond({ error: "Name required" });

  const entry = sessionRegistry.get(sessionId);
  if (entry) {
    entry.name = name;
    if (entry.itermSessionId) {
      try {
        await setItermSessionVar(entry.itermSessionId, name);
        await setItermTabName(entry.itermSessionId, name);
      } catch {
        // best effort
      }
    }
    saveSessionRegistry();
  }

  respond({ name });
}

async function handleSend(
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
  respondError: (e: string) => void,
): Promise<void> {
  const message = String(params.message ?? "");
  if (!message) return respondError("Message required");

  // Check if voice mode
  if (params.voice) {
    const { textToVoiceNote } = await import("../tts.js");
    const audio = await textToVoiceNote(message, voiceConfig.defaultVoice);
    const recipient = params.recipient
      ? resolveRecipient(String(params.recipient))
      : undefined;
    const result = await watcherSendVoiceNote(audio, recipient);
    respond({ sent: true, ...result });
    return;
  }

  const recipient = params.recipient
    ? resolveRecipient(String(params.recipient))
    : undefined;
  const result = await watcherSendMessage(message, recipient);
  respond({ sent: true, ...result });
}

async function handleSendFile(
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
  respondError: (e: string) => void,
): Promise<void> {
  const filePath = String(params.filePath ?? "");
  if (!filePath) return respondError("filePath required");

  const recipient = params.recipient
    ? resolveRecipient(String(params.recipient))
    : undefined;
  const caption = params.caption ? String(params.caption) : undefined;

  // Prettify mode for text files
  if (params.prettify) {
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(filePath, "utf-8");
    const formatted = markdownToTelegram(content);

    // Telegram message limit is ~4096 chars
    const chunks = chunkText(formatted, 4000);
    for (const chunk of chunks) {
      await watcherSendMessage(chunk);
    }
    respond({ sent: true, chunks: chunks.length });
    return;
  }

  const result = await watcherSendFile(filePath, recipient, caption);
  respond({ sent: true, ...result });
}

function handleReceive(
  sessionId: string,
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
): void {
  const from = params.from ? String(params.from) : undefined;

  if (from === "all") {
    // Drain all contact queues + self queue
    const allMessages: Array<QueuedMessage & { from?: string }> = [];

    const selfQueue = clientQueues.get(sessionId);
    if (selfQueue && selfQueue.length > 0) {
      allMessages.push(...selfQueue.splice(0));
    }

    for (const [chatId, queue] of contactMessageQueues) {
      if (queue.length > 0) {
        for (const msg of queue.splice(0)) {
          allMessages.push({ ...msg, from: chatId });
        }
      }
    }

    respond({ messages: allMessages });
  } else if (from) {
    // Drain specific contact queue
    const chatId = resolveRecipient(from);
    const queue = contactMessageQueues.get(chatId) ?? [];
    const messages = queue.splice(0);
    respond({ messages });
  } else {
    // Drain self-chat queue
    const queue = clientQueues.get(sessionId) ?? [];
    const messages = queue.splice(0);
    respond({ messages });
  }
}

function handleWait(
  socket: net.Socket,
  sessionId: string,
  params: Record<string, unknown>,
  requestId: string,
): void {
  const timeoutMs = Math.min(
    Number(params.timeoutMs ?? 120_000),
    300_000,
  );

  // Check if messages already waiting
  const queue = clientQueues.get(sessionId) ?? [];
  if (queue.length > 0) {
    const messages = queue.splice(0);
    sendResponse(socket, {
      id: requestId,
      ok: true,
      result: { messages },
    });
    return;
  }

  // Long-poll: register waiter
  const timer = setTimeout(() => {
    // Remove waiter
    const waiters = clientWaiters.get(sessionId) ?? [];
    const idx = waiters.indexOf(onMessage);
    if (idx !== -1) waiters.splice(idx, 1);
    sendResponse(socket, {
      id: requestId,
      ok: true,
      result: { messages: [] },
    });
  }, timeoutMs);

  const onMessage = (msgs: QueuedMessage[]) => {
    clearTimeout(timer);
    sendResponse(socket, {
      id: requestId,
      ok: true,
      result: { messages: msgs },
    });
  };

  let waiters = clientWaiters.get(sessionId);
  if (!waiters) {
    waiters = [];
    clientWaiters.set(sessionId, waiters);
  }
  waiters.push(onMessage);

  // Clean up on socket close
  socket.on("close", () => {
    clearTimeout(timer);
    const w = clientWaiters.get(sessionId) ?? [];
    const idx = w.indexOf(onMessage);
    if (idx !== -1) w.splice(idx, 1);
  });
}

async function handleLogin(
  respond: (r: Record<string, unknown>) => void,
  respondError: (e: string) => void,
): Promise<void> {
  if (!triggerLoginFn) {
    return respondError("Login function not available");
  }
  // Fire-and-forget
  triggerLoginFn().catch((err) => log("Login error:", String(err)));
  respond({ started: true });
}

function handleContacts(
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
): void {
  const search = params.search ? String(params.search) : undefined;
  const limit = params.limit ? Number(params.limit) : undefined;
  const contacts = getContacts(search, limit);
  respond({ contacts });
}

function handleChats(
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
): void {
  const search = params.search ? String(params.search) : undefined;
  const limit = params.limit ? Number(params.limit) : 50;

  let chats = Array.from(chatStore.values());

  if (search) {
    const lower = search.toLowerCase();
    chats = chats.filter(
      (c) =>
        c.title.toLowerCase().includes(lower) ||
        c.username?.toLowerCase().includes(lower) ||
        c.id.includes(search),
    );
  }

  chats.sort(
    (a, b) => (b.lastMessageDate ?? 0) - (a.lastMessageDate ?? 0),
  );
  respond({ chats: chats.slice(0, limit) });
}

async function handleHistory(
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
  respondError: (e: string) => void,
): Promise<void> {
  const chatId = String(params.chatId ?? "");
  if (!chatId) return respondError("chatId required");

  const count = Number(params.count ?? 20);

  if (!watcherClient) return respondError("Not connected");

  try {
    const peer = chatId === "me" ? "me" : resolveRecipient(chatId);
    const messages = await watcherClient.getMessages(peer, { limit: count });

    const formatted = messages.map((msg) => ({
      id: msg.id,
      text: msg.message ?? "",
      date: msg.date,
      fromMe: msg.out,
      hasMedia: !!(msg.media),
    }));

    respond({ messages: formatted });
  } catch (err) {
    respondError(`History fetch failed: ${err}`);
  }
}

async function handleTts(
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
  respondError: (e: string) => void,
): Promise<void> {
  const text = String(params.text ?? "");
  if (!text) return respondError("Text required");

  const voice = params.voice ? String(params.voice) : voiceConfig.defaultVoice;
  const recipient = params.recipient
    ? resolveRecipient(String(params.recipient))
    : undefined;

  try {
    const { textToVoiceNote } = await import("../tts.js");
    const audioBuffer = await textToVoiceNote(text, voice);
    const result = await watcherSendVoiceNote(audioBuffer, recipient);
    respond({ sent: true, voice, ...result });
  } catch (err) {
    respondError(`TTS failed: ${err}`);
  }
}

async function handleSpeak(
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
  respondError: (e: string) => void,
): Promise<void> {
  const text = String(params.text ?? "");
  if (!text) return respondError("Text required");

  const voice = params.voice ? String(params.voice) : voiceConfig.defaultVoice;

  try {
    const { speakLocally } = await import("../tts.js");
    await speakLocally(text, voice);
    respond({ speaking: true, voice });
  } catch (err) {
    respondError(`Speak failed: ${err}`);
  }
}

function handleVoiceConfig(
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
): void {
  if (params.action === "set") {
    const newConfig = { ...voiceConfig };
    if (params.defaultVoice !== undefined)
      newConfig.defaultVoice = String(params.defaultVoice);
    if (params.voiceMode !== undefined)
      newConfig.voiceMode = Boolean(params.voiceMode);
    if (params.localMode !== undefined)
      newConfig.localMode = Boolean(params.localMode);
    if (params.personas !== undefined)
      newConfig.personas = params.personas as Record<string, string>;
    setVoiceConfig(newConfig);
    saveVoiceConfig();
    respond(newConfig as unknown as Record<string, unknown>);
  } else {
    respond(voiceConfig as unknown as Record<string, unknown>);
  }
}

async function handleCommand(
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
): Promise<void> {
  const text = String(params.text ?? "");
  if (!text) return respond({ error: "Text required" });

  // Import command handler from state
  const { commandHandler } = await import("./state.js");
  if (commandHandler) {
    await commandHandler(text, 0, Math.floor(Date.now() / 1000));
  }
  respond({ executed: true });
}

async function handleDiscover(
  respond: (r: Record<string, unknown>) => void,
): Promise<void> {
  await discoverSessions();
  const sessions = Array.from(sessionRegistry.values()).map((s, i) => ({
    index: i + 1,
    name: s.name,
    sessionId: s.sessionId,
    active: s.sessionId === activeClientId,
  }));
  respond({ sessions });
}

function handleSessions(
  currentSessionId: string,
  respond: (r: Record<string, unknown>) => void,
): void {
  const sessions = Array.from(sessionRegistry.values()).map((s, i) => ({
    index: i + 1,
    name: s.name,
    type: s.sessionId.startsWith("discovered-") ? "discovered" : "registered",
    active: s.sessionId === activeClientId,
  }));
  respond({ sessions });
}

async function handleSwitch(
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
  respondError: (e: string) => void,
): Promise<void> {
  const target = String(params.target ?? "");
  if (!target) return respondError("Target required");

  const sessions = Array.from(sessionRegistry.values());

  // Try numeric index (1-based)
  const idx = parseInt(target, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
    const session = sessions[idx - 1];
    setActiveClientId(session.sessionId);
    if (session.itermSessionId) {
      setActiveItermSessionId(session.itermSessionId);
      try {
        const { typeIntoSession } = await import("./iterm-core.js");
        // Focus the window
      } catch {
        // best effort
      }
    }
    respond({ switched: true, name: session.name });
    return;
  }

  // Try name substring match
  const lower = target.toLowerCase();
  const match = sessions.find((s) =>
    s.name.toLowerCase().includes(lower),
  );
  if (match) {
    setActiveClientId(match.sessionId);
    if (match.itermSessionId) {
      setActiveItermSessionId(match.itermSessionId);
    }
    respond({ switched: true, name: match.name });
    return;
  }

  respondError(`No session matching "${target}"`);
}

async function handleEndSession(
  params: Record<string, unknown>,
  respond: (r: Record<string, unknown>) => void,
  respondError: (e: string) => void,
): Promise<void> {
  const target = String(params.target ?? "");
  if (!target) return respondError("Target required");

  const sessions = Array.from(sessionRegistry.values());
  const idx = parseInt(target, 10);

  let session;
  if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
    session = sessions[idx - 1];
  } else {
    const lower = target.toLowerCase();
    session = sessions.find((s) =>
      s.name.toLowerCase().includes(lower),
    );
  }

  if (!session) return respondError(`No session matching "${target}"`);

  // Kill the session
  if (session.itermSessionId) {
    try {
      const { killSession } = await import("./iterm-sessions.js");
      await killSession(session.itermSessionId);
    } catch {
      // best effort
    }
  }

  // Clean up registry
  sessionRegistry.delete(session.sessionId);
  clientQueues.delete(session.sessionId);
  clientWaiters.delete(session.sessionId);

  // If we just killed the active session, pick another
  if (activeClientId === session.sessionId) {
    const remaining = Array.from(sessionRegistry.values());
    if (remaining.length > 0) {
      setActiveClientId(remaining[0].sessionId);
      if (remaining[0].itermSessionId) {
        setActiveItermSessionId(remaining[0].itermSessionId);
      }
    } else {
      setActiveClientId(null);
    }
  }

  saveSessionRegistry();
  respond({ ended: true, name: session.name });
}

function handleHealth(
  respond: (r: Record<string, unknown>) => void,
): void {
  const now = Date.now();
  const lastMessageAgo =
    adapterStats.lastMessageAt !== null
      ? Math.floor((now - adapterStats.lastMessageAt) / 1000)
      : null;
  respond({
    status: watcherStatus.connected ? "healthy" : "degraded",
    connected: watcherStatus.connected,
    stats: { ...adapterStats },
    lastMessageAgo,
  });
}

function handleConnectionStatus(
  respond: (r: Record<string, unknown>) => void,
): void {
  let status: "connected" | "connecting" | "disconnected" | "error";
  if (watcherStatus.connected) {
    status = "connected";
  } else if (watcherStatus.awaitingCode) {
    status = "connecting";
  } else {
    status = "disconnected";
  }
  respond({ status, phoneNumber: watcherStatus.phoneNumber });
}

// ── Hub deliver handler ──────────────────────────────────────────────────────

/**
 * deliver — Hub calls this to deliver a routed BrokerMessage.
 *
 * Maps BrokerMessage types to existing Telegram send functions:
 *   text    -> watcherSendMessage
 *   voice   -> watcherSendVoiceNote (via TTS)
 *   command -> commandHandler (runs as if typed in Telegram self-chat)
 */
async function handleDeliver(
  sock: net.Socket,
  reqId: string,
  params: Record<string, unknown>,
): Promise<void> {
  // BrokerMessage is passed as a plain object
  const msg = params as Record<string, unknown>;
  const type = String(msg.type ?? "text");
  const payload = (msg.payload ?? {}) as Record<string, unknown>;
  const text = String(payload.text ?? "");
  const recipient = payload.recipient != null ? String(payload.recipient) : undefined;
  const timestamp = typeof msg.timestamp === "number" ? msg.timestamp : Date.now();

  log(`IPC: deliver type=${type} from=${msg.source} text=${text.slice(0, 60)}`);

  try {
    switch (type) {
      case "text": {
        if (!text) {
          sendResponse(sock, { id: reqId, ok: false, error: "payload.text is required for text delivery" });
          sock.end();
          return;
        }
        const result = await watcherSendMessage(text, recipient);
        sendResponse(sock, { id: reqId, ok: true, result: { delivered: true, ...result } });
        break;
      }

      case "voice": {
        if (!text) {
          sendResponse(sock, { id: reqId, ok: false, error: "payload.text is required for voice delivery" });
          sock.end();
          return;
        }
        const voice = payload.voice ? String(payload.voice) : voiceConfig.defaultVoice;
        const { textToVoiceNote } = await import("../tts.js");
        const audioBuffer = await textToVoiceNote(text, voice);
        const result = await watcherSendVoiceNote(audioBuffer, recipient);
        sendResponse(sock, { id: reqId, ok: true, result: { delivered: true, type: "voice", ...result } });
        break;
      }

      case "command": {
        if (!text) {
          sendResponse(sock, { id: reqId, ok: false, error: "payload.text is required for command delivery" });
          sock.end();
          return;
        }
        const { commandHandler } = await import("./state.js");
        if (!commandHandler) {
          sendResponse(sock, { id: reqId, ok: false, error: "commandHandler not initialised" });
          sock.end();
          return;
        }
        await commandHandler(text, 0, timestamp);
        sendResponse(sock, { id: reqId, ok: true, result: { delivered: true, type: "command" } });
        break;
      }

      default:
        sendResponse(sock, { id: reqId, ok: false, error: `Unsupported deliver type: ${type}` });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    sendResponse(sock, { id: reqId, ok: false, error: errMsg });
  }
  sock.end();
}

// ── Helpers ──

function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to break at newline
    let breakIdx = remaining.lastIndexOf("\n", maxLen);
    if (breakIdx < maxLen / 2) breakIdx = maxLen;
    chunks.push(remaining.slice(0, breakIdx));
    remaining = remaining.slice(breakIdx);
  }
  return chunks;
}

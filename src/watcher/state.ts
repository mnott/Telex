// ── Re-export shared state from AIBroker ──
// Notes on what is NOT re-exported from AIBroker:
// - contactDirectory: Telex's ContactEntry uses chatId (not id)
// - commandHandler / setCommandHandler: Telex's MessageHandler has 3 args
//   (text, msgId, timestamp) vs AIBroker's 2-arg CommandHandler

export {
  sessionRegistry,
  managedSessions,
  sessionTtyCache,
  activeClientId,
  activeItermSessionId,
  setActiveClientId,
  setActiveItermSessionId,
  updateSessionTtyCache,
  cachedSessionList,
  cachedSessionListTime,
  setCachedSessionList,
  clientQueues,
  clientWaiters,
  contactMessageQueues,
  voiceConfig,
  setVoiceConfig,
  sentMessageIds,
  dispatchIncomingMessage,
  enqueueContactMessage,
} from "aibroker";

// ── Adapter Stats ──

export const adapterStats = {
  messagesReceived: 0,
  messagesSent: 0,
  errors: 0,
  lastMessageAt: null as number | null,
};

// ── Telegram-Specific State ──

import type { TelegramClient } from "telegram";
import type { TelegramChat, WatcherStatus, ContactEntry, MessageHandler } from "./types.js";

export let watcherClient: TelegramClient | null = null;
export let watcherStatus: WatcherStatus = {
  connected: false,
  phoneNumber: "",
  selfId: "",
  awaitingCode: false,
};

export function setWatcherClient(client: TelegramClient | null): void {
  watcherClient = client;
}

export function setWatcherStatus(status: Partial<WatcherStatus>): void {
  watcherStatus = { ...watcherStatus, ...status };
}

export const chatStore = new Map<string, TelegramChat>();

// Telegram-specific contact directory: keyed by chatId, using local ContactEntry type
export const contactDirectory = new Map<string, ContactEntry>();

// Command handler — uses Telex's 3-arg MessageHandler (not AIBroker's 2-arg CommandHandler)
export let commandHandler: MessageHandler | null = null;
export function setCommandHandler(handler: MessageHandler | null): void {
  commandHandler = handler;
}

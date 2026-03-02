// ── Re-export shared types from AIBroker ──

export type {
  IpcRequest,
  IpcResponse,
  RegisteredSession,
  QueuedMessage,
  SessionRegistryData,
  VoiceConfig,
} from "aibroker";

// ── Telegram-Specific Types ──

// Keep ContactEntry local: Telegram uses chatId field (not id)
export interface ContactEntry {
  chatId: string;        // Telegram chat/user ID
  name: string;
  username?: string;
  lastSeen: number;
}

// Keep WatcherStatus local: has awaitingCode (not awaitingAuth)
export interface WatcherStatus {
  connected: boolean;
  phoneNumber: string;
  selfId: string;
  awaitingCode: boolean;
}

// Keep TelegramChat local: Telegram-specific structure
export interface TelegramChat {
  id: string;
  title: string;
  type: "private" | "group" | "supergroup" | "channel";
  username?: string;
  lastMessage?: string;
  lastMessageDate?: number;
}

// Keep MessageHandler local: Telegram uses msgId (not messageId), 3-arg signature
export type MessageHandler = (
  text: string,
  msgId: number,
  timestamp: number,
) => Promise<void>;

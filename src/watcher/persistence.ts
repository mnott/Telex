// ── Re-export shared persistence from AIBroker ──

export {
  setAppDir,
  getAppDir,
  DEFAULT_VOICE_CONFIG,
  loadVoiceConfig,
  saveVoiceConfig,
  loadSessionRegistry,
  saveSessionRegistry,
} from "aibroker";

// ── Telegram-Specific Cache Functions ──

import { getAppDir } from "aibroker";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chatStore, contactDirectory } from "./state.js";
import type { TelegramChat } from "./types.js";
import type { ContactEntry } from "./types.js";

function ensureDir(): void {
  mkdirSync(getAppDir(), { recursive: true });
}

function safeReadJson<T>(filename: string): T | null {
  try {
    const path = join(getAppDir(), filename);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function safeWriteJson(filename: string, data: unknown): void {
  ensureDir();
  writeFileSync(join(getAppDir(), filename), JSON.stringify(data, null, 2), "utf-8");
}

// ── Chat Cache ──

export function loadChatCache(): void {
  const data = safeReadJson<TelegramChat[]>("chat-cache.json");
  if (!data) return;
  chatStore.clear();
  for (const chat of data) {
    chatStore.set(chat.id, chat);
  }
}

export function saveChatCache(): void {
  const chats = Array.from(chatStore.values());
  safeWriteJson("chat-cache.json", chats);
}

// ── Contact Cache ──

export function loadContactCache(): void {
  const data = safeReadJson<ContactEntry[]>("contact-cache.json");
  if (!data) return;
  contactDirectory.clear();
  for (const entry of data) {
    contactDirectory.set(entry.chatId, entry);
  }
}

export function saveContactCache(): void {
  const contacts = Array.from(contactDirectory.values());
  safeWriteJson("contact-cache.json", contacts);
}

// ── Store Cache (combined save/load) ──

export function loadStoreCache(): void {
  loadChatCache();
  loadContactCache();
}

export function saveStoreCache(): void {
  saveChatCache();
  saveContactCache();
}

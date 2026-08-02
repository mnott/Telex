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

import { getAppDir, loadJson, saveJson } from "aibroker";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chatStore, contactDirectory } from "./state.js";
import type { TelegramChat } from "./types.js";
import type { ContactEntry } from "./types.js";

function ensureDir(): void {
  mkdirSync(getAppDir(), { recursive: true });
}

/**
 * Read a cache file, distinguishing absent from unreadable.
 *
 * This used to be a local pair that returned null for BOTH — so a corrupt
 * chat-cache.json read as "no chats", and the next save wrote an empty one over
 * it. AIBroker fixed the same shape in its own persistence and now exports the
 * primitive, so this is a call rather than a copy: a copy of a fix is a fix
 * that stops travelling.
 *
 * A cache is cheaper to lose than a session registry — the worst case is a
 * refetch — which is why this was low priority, not why it was acceptable.
 */
function safeReadJson<T>(filename: string): T | null {
  const res = loadJson<T>(join(getAppDir(), filename));
  if (res.status === "ok") return res.data;
  if (res.status === "unreadable") {
    // Say so. Silently treating a damaged cache as an empty one is what let it
    // be overwritten without anyone noticing it had ever held anything.
    console.error(`[telex] ${filename} is unreadable and was NOT overwritten: ${res.error}`);
  }
  return null;
}

/** Write atomically, keeping a .bak, and never over a file we could not parse. */
function safeWriteJson(filename: string, data: unknown): void {
  ensureDir();
  saveJson(join(getAppDir(), filename), data);
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

import { contactDirectory, chatStore, watcherClient } from "./state.js";
import type { ContactEntry } from "./types.js";
import { log } from "./log.js";

// ── Markdown → Telegram HTML ──

/**
 * Convert markdown to Telegram HTML format.
 * Telegram supports: <b>, <i>, <code>, <pre>, <s>, <a>, <blockquote>
 */
export function markdownToTelegram(text: string): string {
  return (
    text
      // Code blocks first (protect from other transforms)
      .replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => `<pre>${escapeHtml(code.trim())}</pre>`)
      // Inline code
      .replace(/`([^`]+)`/g, (_m, code) => `<code>${escapeHtml(code)}</code>`)
      // Bold **text**
      .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
      // Italic *text* (not inside bold)
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/gs, "<i>$1</i>")
      // Strikethrough ~~text~~
      .replace(/~~(.+?)~~/gs, "<s>$1</s>")
      // Headings → bold uppercase
      .replace(/^#{1,6}\s+(.+)$/gm, (_m, t) => `<b>${t.toUpperCase()}</b>`)
      // Horizontal rules
      .replace(/^---+$/gm, "———")
      // Blockquotes
      .replace(/^>\s?(.*)$/gm, "<blockquote>$1</blockquote>")
      // Merge adjacent blockquotes
      .replace(/<\/blockquote>\n<blockquote>/g, "\n")
      // Checkboxes
      .replace(/^(\s*)- \[x\]\s+/gm, "$1☑ ")
      .replace(/^(\s*)- \[ \]\s+/gm, "$1☐ ")
      // Unordered lists
      .replace(/^(\s*)[-*]\s+/gm, "$1• ")
      // Links [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Chat ID Resolution ──

/**
 * Resolve a recipient string to a Telegram chat identifier.
 * Accepts: username (@user), phone number, numeric chat ID, or contact name.
 */
export function resolveRecipient(input: string): string {
  if (!input || input === "me") return "me";

  // Already a numeric ID
  if (/^-?\d+$/.test(input)) return input;

  // Username
  if (input.startsWith("@")) return input;

  // Phone number pattern
  if (/^\+?\d{7,15}$/.test(input.replace(/[\s-]/g, ""))) {
    return input.replace(/[\s-]/g, "");
  }

  // Try name lookup in contact directory
  const byName = resolveNameToChatId(input);
  if (byName) return byName;

  // Fallback: return as-is (let gramjs resolve it)
  return input;
}

/**
 * Case-insensitive name lookup in the contact directory.
 */
export function resolveNameToChatId(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [chatId, entry] of contactDirectory) {
    if (entry.name.toLowerCase().includes(lower)) return chatId;
    if (entry.username?.toLowerCase() === lower) return chatId;
  }
  return null;
}

/**
 * Get merged contact list from directory + chat store.
 */
export function getContacts(
  search?: string,
  limit?: number,
): ContactEntry[] {
  const all = Array.from(contactDirectory.values());

  // Sort by lastSeen descending
  all.sort((a, b) => b.lastSeen - a.lastSeen);

  let filtered = all;
  if (search) {
    const lower = search.toLowerCase();
    filtered = all.filter(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        c.username?.toLowerCase().includes(lower) ||
        c.chatId.includes(search),
    );
  }

  return limit ? filtered.slice(0, limit) : filtered;
}

// ── MIME Map ──

export const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
};

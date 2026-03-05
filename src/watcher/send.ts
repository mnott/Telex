import { watcherClient, watcherStatus, sentMessageIds, adapterStats } from "./state.js";
import { markdownToTelegram } from "./contacts.js";
import { stopTypingIndicator } from "./typing.js";
import { log } from "./log.js";

/**
 * Send a text message via the watcher's Telegram client.
 * Prepends U+FEFF for self-echo suppression.
 */
export async function watcherSendMessage(
  message: string,
  recipient?: string,
): Promise<{ preview: string; targetChatId: string }> {
  if (!watcherClient) throw new Error("Telegram client not connected");

  stopTypingIndicator();

  const targetChatId = recipient ?? "me";
  const formatted = "\uFEFF" + markdownToTelegram(message);

  const result = await watcherClient.sendMessage(targetChatId, {
    message: formatted,
    parseMode: "html",
  });

  // Track sent message ID for self-echo suppression
  if (result && result.id) {
    sentMessageIds.add(result.id);
    setTimeout(() => sentMessageIds.delete(result.id), 30_000);
  }

  adapterStats.messagesSent++;

  const preview =
    message.length > 100 ? message.slice(0, 100) + "…" : message;

  return { preview, targetChatId };
}

/**
 * Send a file via the watcher's Telegram client.
 */
export async function watcherSendFile(
  filePath: string,
  recipient?: string,
  caption?: string,
  voiceNote?: boolean,
): Promise<{ targetChatId: string }> {
  if (!watcherClient) throw new Error("Telegram client not connected");

  stopTypingIndicator();

  const targetChatId = recipient ?? "me";

  await watcherClient.sendFile(targetChatId, {
    file: filePath,
    caption: caption ? "\uFEFF" + caption : undefined,
    voiceNote: voiceNote ?? false,
  });

  adapterStats.messagesSent++;

  return { targetChatId };
}

/**
 * Send a voice note (OGG Opus buffer) via Telegram.
 */
export async function watcherSendVoiceNote(
  audioBuffer: Buffer,
  recipient?: string,
): Promise<{ targetChatId: string }> {
  if (!watcherClient) throw new Error("Telegram client not connected");

  stopTypingIndicator();

  const targetChatId = recipient ?? "me";

  // gramjs CustomFile for buffer uploads
  const { CustomFile } = await import("telegram/client/uploads.js");
  const file = new CustomFile(
    "voice.ogg",
    audioBuffer.length,
    "",
    audioBuffer,
  );

  const result = await watcherClient.sendFile(targetChatId, {
    file,
    voiceNote: true,
  });

  if (result && result.id) {
    sentMessageIds.add(result.id);
    setTimeout(() => sentMessageIds.delete(result.id), 30_000);
  }

  adapterStats.messagesSent++;

  return { targetChatId };
}

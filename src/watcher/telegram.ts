import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { Api } from "telegram/tl/index.js";
import { CustomFile } from "telegram/client/uploads.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { log } from "./log.js";
import {
  setWatcherClient,
  setWatcherStatus,
  watcherStatus,
  sentMessageIds,
  commandHandler,
  contactDirectory,
  chatStore,
} from "./state.js";
import type { MessageHandler, TelegramChat } from "./types.js";

import { createInterface } from "node:readline";

const TELEX_DIR = join(homedir(), ".telex");
const AUTH_DIR = join(TELEX_DIR, "auth");
const SESSION_FILE = join(AUTH_DIR, "session.txt");

function readStdin(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function ensureAuthDir(): void {
  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
}

function loadSession(): string {
  ensureAuthDir();
  if (existsSync(SESSION_FILE)) {
    return readFileSync(SESSION_FILE, "utf-8").trim();
  }
  return "";
}

function saveSession(session: string): void {
  ensureAuthDir();
  writeFileSync(SESSION_FILE, session, "utf-8");
}

export function getApiCredentials(): { apiId: number; apiHash: string } {
  const apiId = parseInt(process.env.TELEGRAM_API_ID ?? "", 10);
  const apiHash = process.env.TELEGRAM_API_HASH ?? "";
  if (!apiId || !apiHash) {
    throw new Error(
      "Missing TELEGRAM_API_ID and/or TELEGRAM_API_HASH environment variables.\n" +
        "Get these from https://my.telegram.org/apps",
    );
  }
  return { apiId, apiHash };
}

let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 60_000;

function getReconnectDelay(): number {
  const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  return delay;
}

export async function connectWatcher(
  onMessage: MessageHandler,
): Promise<{ cleanup: () => Promise<void>; triggerLogin: () => Promise<void> }> {
  const { apiId, apiHash } = getApiCredentials();
  const sessionStr = loadSession();
  const stringSession = new StringSession(sessionStr);

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  // Suppress gramjs internal logs
  client.setLogLevel("none" as any);

  setWatcherClient(client);

  async function startClient(): Promise<void> {
    await client.connect();

    if (await client.isUserAuthorized()) {
      log("Session restored — already authorized");
    } else {
      // Primary: QR code login (scan with phone)
      // Fallback: phone + code (if TELEGRAM_PHONE is set)
      const usePhoneAuth = !!process.env.TELEGRAM_PHONE;

      if (usePhoneAuth) {
        log("TELEGRAM_PHONE set — using phone+code auth");
        await client.start({
          phoneNumber: async () => process.env.TELEGRAM_PHONE!,
          phoneCode: async () => {
            setWatcherStatus({ awaitingCode: true });
            log("Telegram sent a verification code to your app.");
            return await readStdin("Enter the code: ");
          },
          password: async () => {
            const pw = process.env.TELEGRAM_2FA_PASSWORD;
            if (pw) return pw;
            return await readStdin("Enter your 2FA password: ");
          },
          onError: (err) => log("Auth error:", String(err)),
        });
      } else {
        log("Starting QR code login — scan with your Telegram app...\n");
        await loginWithQrCode(client);
      }
    }

    // Save session
    const newSession = client.session.save() as unknown as string;
    saveSession(newSession);

    // Get self info
    const me = await client.getMe();
    const selfId = me.id.toString();
    const phoneNumber = (me as any).phone ?? "";

    setWatcherStatus({
      connected: true,
      phoneNumber,
      selfId,
      awaitingCode: false,
    });

    reconnectAttempts = 0;
    log(`Connected as ${phoneNumber || selfId}`);

    // Send startup message to Saved Messages
    try {
      await client.sendMessage("me", {
        message: "\uFEFFTelex watcher started",
      });
    } catch (e) {
      log("Could not send startup message:", String(e));
    }

    // Load initial dialogs for chat store
    try {
      const dialogs = await client.getDialogs({ limit: 50 });
      for (const dialog of dialogs) {
        const entity = dialog.entity;
        if (!entity) continue;
        const chatId = entity.id.toString();
        const chat: TelegramChat = {
          id: chatId,
          title: dialog.title ?? dialog.name ?? chatId,
          type: getEntityType(entity),
          username: (entity as any).username,
          lastMessage: dialog.message?.message,
          lastMessageDate: dialog.message?.date,
        };
        chatStore.set(chatId, chat);
      }
      log(`Loaded ${chatStore.size} dialogs`);
    } catch (e) {
      log("Could not load dialogs:", String(e));
    }

    // Register message handler
    client.addEventHandler(async (event: NewMessageEvent) => {
      try {
        await handleIncomingMessage(event, onMessage);
      } catch (err) {
        log("Error handling message:", String(err));
      }
    }, new NewMessage({}));
  }

  async function handleDisconnect(): Promise<void> {
    setWatcherStatus({ connected: false });
    const delay = getReconnectDelay();
    log(`Disconnected. Reconnecting in ${delay}ms...`);
    await new Promise((r) => setTimeout(r, delay));
    try {
      await client.connect();
      setWatcherStatus({ connected: true });
      reconnectAttempts = 0;
      log("Reconnected");
    } catch (err) {
      log("Reconnect failed:", String(err));
      handleDisconnect();
    }
  }

  // Handle connection state changes
  client.addEventHandler((update: Api.TypeUpdate) => {
    // gramjs doesn't have a clean disconnect event like Baileys
    // We handle it via try/catch on operations
  });

  try {
    await startClient();
  } catch (err) {
    log("Initial connection failed:", String(err));
    throw err;
  }

  async function cleanup(): Promise<void> {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
    setWatcherClient(null);
    setWatcherStatus({ connected: false });
  }

  async function triggerLogin(): Promise<void> {
    log("Triggering fresh login...");
    setWatcherStatus({ connected: false, awaitingCode: true });
    // Clear existing session
    if (existsSync(SESSION_FILE)) {
      writeFileSync(SESSION_FILE, "", "utf-8");
    }
    try {
      await cleanup();
    } catch {
      // ignore
    }
    const newClient = new TelegramClient(
      new StringSession(""),
      apiId,
      apiHash,
      { connectionRetries: 5 },
    );
    setWatcherClient(newClient);
    await startClient();
  }

  return { cleanup, triggerLogin };
}

async function loginWithQrCode(client: TelegramClient): Promise<void> {
  // @ts-ignore — no type declarations for qrcode-terminal
  const qrMod = (await import("qrcode-terminal")) as any;
  const qrTerminal = qrMod.default ?? qrMod;

  return new Promise<void>((resolve, reject) => {
    let resolved = false;

    client.signInUserWithQrCode(
      { apiId: client.apiId, apiHash: client.apiHash },
      {
        qrCode: async (qrCode: { token: Buffer; expires: number }) => {
          // Encode token as base64url for tg:// URI
          const tokenBase64 = qrCode.token
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
          const url = `tg://login?token=${tokenBase64}`;

          // Clear screen and show QR
          process.stderr.write("\x1B[2J\x1B[0;0H");
          process.stderr.write("Scan this QR code with Telegram on your phone:\n\n");
          qrTerminal.generate(url, { small: true }, (qr: string) => {
            process.stderr.write(qr + "\n");
          });
          const expiresIn = Math.round(qrCode.expires - Date.now() / 1000);
          process.stderr.write(
            `\nQR expires in ${expiresIn}s — will auto-refresh\n`,
          );
        },
        password: async (hint: string | undefined) => {
          const pw = process.env.TELEGRAM_2FA_PASSWORD;
          if (pw) return pw;
          const hintMsg = hint ? ` (hint: ${hint})` : "";
          return await readStdin(`Enter your 2FA password${hintMsg}: `);
        },
        onError: async (err: Error) => {
          if (!resolved) {
            log("QR auth error:", String(err));
          }
          // Return true to stop on fatal errors
          return false;
        },
      },
    ).then(() => {
      resolved = true;
      process.stderr.write("\n✓ QR login successful!\n\n");
      resolve();
    }).catch((err: Error) => {
      if (!resolved) reject(err);
    });
  });
}

async function handleIncomingMessage(
  event: NewMessageEvent,
  onMessage: MessageHandler,
): Promise<void> {
  const msg = event.message;
  if (!msg) return;

  const text = msg.message ?? "";
  const msgId = msg.id;
  const timestamp = msg.date ?? Math.floor(Date.now() / 1000);

  // Determine if this is from Saved Messages (self-chat)
  const selfId = watcherStatus.selfId;
  const chatId = msg.chatId?.toString() ?? "";
  const senderId = msg.senderId?.toString() ?? "";
  const isSelf = senderId === selfId && chatId === selfId;

  // Self-echo suppression
  if (sentMessageIds.has(msgId)) {
    sentMessageIds.delete(msgId);
    return;
  }

  // Skip our own outgoing messages tagged with FEFF
  if (text.startsWith("\uFEFF")) return;

  if (isSelf) {
    // Self-chat (Saved Messages)
    if (msg.voice || msg.audio) {
      // Voice/audio message — download and transcribe
      const transcript = await downloadAndTranscribe(msg);
      if (transcript) {
        await onMessage(transcript, msgId, timestamp);
      }
    } else if (msg.photo || msg.sticker) {
      // Image — download to temp
      const filePath = await downloadMedia(msg);
      if (filePath) {
        const caption = text ? ` | ${text}` : "";
        await onMessage(`${filePath}${caption}`, msgId, timestamp);
      }
    } else if (msg.document && !msg.voice && !msg.audio) {
      // Document
      const filePath = await downloadMedia(msg);
      if (filePath) {
        const caption = text ? ` | ${text}` : "";
        await onMessage(`[File]: ${filePath}${caption}`, msgId, timestamp);
      }
    } else if (text) {
      await onMessage(text, msgId, timestamp);
    }
  } else {
    // Message from someone else — queue for contact handling
    const { enqueueContactMessage } = await import("./state.js");
    trackContact(msg);

    if (msg.voice || msg.audio) {
      const transcript = await downloadAndTranscribe(msg);
      if (transcript) {
        enqueueContactMessage(chatId, transcript, timestamp);
      }
    } else if (text) {
      enqueueContactMessage(chatId, text, timestamp);
    }
  }
}

function trackContact(msg: Api.Message): void {
  const chatId = msg.chatId?.toString() ?? "";
  if (!chatId) return;

  const sender = msg.sender;
  if (!sender) return;

  const name =
    (sender as any).firstName ??
    (sender as any).title ??
    (sender as any).username ??
    chatId;
  const username = (sender as any).username;

  contactDirectory.set(chatId, {
    chatId,
    name,
    username,
    lastSeen: Date.now(),
  });
}

function getEntityType(
  entity: any,
): "private" | "group" | "supergroup" | "channel" {
  if (entity.className === "User") return "private";
  if (entity.className === "Chat") return "group";
  if (entity.className === "Channel") {
    return entity.megagroup ? "supergroup" : "channel";
  }
  return "private";
}

async function downloadAndTranscribe(msg: Api.Message): Promise<string | null> {
  try {
    const { downloadAudioAndTranscribe } = await import("./media.js");
    return await downloadAudioAndTranscribe(msg);
  } catch (err) {
    log("Transcription error:", String(err));
    return null;
  }
}

async function downloadMedia(msg: Api.Message): Promise<string | null> {
  try {
    const { downloadMediaToTemp } = await import("./media.js");
    return await downloadMediaToTemp(msg);
  } catch (err) {
    log("Download error:", String(err));
    return null;
  }
}

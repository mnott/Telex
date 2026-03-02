import { spawnSync } from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Api } from "telegram/tl/index.js";
import { watcherClient } from "./state.js";
import { log } from "./log.js";

// ── Whisper Binary Resolution ──

const WHISPER_CANDIDATES = [
  "/opt/homebrew/bin/whisper",
  "/usr/local/bin/whisper",
  "whisper",
];

let whisperBin: string | null = null;
for (const candidate of WHISPER_CANDIDATES) {
  try {
    const result = spawnSync("which", [candidate], { encoding: "utf-8" });
    if (result.status === 0) {
      whisperBin = result.stdout.trim() || candidate;
      break;
    }
  } catch {
    // try next
  }
}
// Last resort: just use "whisper" and let PATH resolve it
if (!whisperBin) whisperBin = "whisper";

const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "small";

// ── Audio Download & Transcription ──

export async function downloadAudioAndTranscribe(
  msg: Api.Message,
): Promise<string | null> {
  if (!watcherClient) return null;

  const isPtt = !!msg.voice;
  const tmpPath = join(tmpdir(), `telex-audio-${Date.now()}.ogg`);

  try {
    // Download media via gramjs
    const buffer = await watcherClient.downloadMedia(msg, {});
    if (!buffer || !(buffer instanceof Buffer)) return null;

    writeFileSync(tmpPath, buffer);

    // Run Whisper
    const result = spawnSync(
      whisperBin!,
      [
        tmpPath,
        "--model",
        WHISPER_MODEL,
        "--output_format",
        "txt",
        "--output_dir",
        tmpdir(),
        "--verbose",
        "False",
      ],
      { encoding: "utf-8", timeout: 120_000 },
    );

    if (result.status !== 0) {
      log("Whisper failed:", result.stderr);
      return null;
    }

    // Read transcript
    const txtPath = tmpPath.replace(/\.ogg$/, ".txt");
    if (!existsSync(txtPath)) return null;

    const transcript = readFileSync(txtPath, "utf-8").trim();
    // Cleanup
    safeUnlink(txtPath);

    return isPtt
      ? `[Voice note]: ${transcript}`
      : `[Audio]: ${transcript}`;
  } catch (err) {
    log("Transcription error:", String(err));
    return null;
  } finally {
    safeUnlink(tmpPath);
  }
}

// ── Media Download to Temp ──

export async function downloadMediaToTemp(
  msg: Api.Message,
): Promise<string | null> {
  if (!watcherClient) return null;

  const ext = getMediaExtension(msg);
  const tmpPath = join(tmpdir(), `telex-media-${Date.now()}${ext}`);

  try {
    const buffer = await watcherClient.downloadMedia(msg, {});
    if (!buffer || !(buffer instanceof Buffer)) return null;

    writeFileSync(tmpPath, buffer);
    return tmpPath;
  } catch (err) {
    log("Media download error:", String(err));
    return null;
  }
}

function getMediaExtension(msg: Api.Message): string {
  if (msg.photo) return ".jpg";
  if (msg.sticker) return ".webp";
  if (msg.voice) return ".ogg";
  if (msg.audio) return ".mp3";
  if (msg.video) return ".mp4";
  if (msg.document) {
    const doc = msg.document as Api.Document;
    for (const attr of doc.attributes ?? []) {
      if ("fileName" in attr && (attr as any).fileName) {
        const name = (attr as any).fileName as string;
        const dotIdx = name.lastIndexOf(".");
        if (dotIdx > 0) return name.slice(dotIdx);
      }
    }
    return ".bin";
  }
  return ".bin";
}

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
}

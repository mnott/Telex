import { spawn } from "node:child_process";
import {
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// ── Kokoro TTS (lazy singleton) ──

let kokoroInstance: any = null;

async function getKokoro(): Promise<any> {
  if (kokoroInstance) return kokoroInstance;
  try {
    const { KokoroTTS } = await import("kokoro-js");
    kokoroInstance = await KokoroTTS.from_pretrained(
      "onnx-community/Kokoro-82M-v1.0-ONNX",
      { dtype: "q8" },
    );
    return kokoroInstance;
  } catch (err) {
    throw new Error(`Failed to load Kokoro TTS: ${err}`);
  }
}

// ── Available Voices ──

export const VOICES = [
  "af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky",
  "am_adam", "am_michael",
  "bf_emma", "bf_isabella",
  "bm_george", "bm_lewis", "bm_daniel", "bm_fable",
] as const;

// ── Text → OGG Opus Buffer ──

export async function textToVoiceNote(
  text: string,
  voice?: string,
): Promise<Buffer> {
  const kokoro = await getKokoro();
  const selectedVoice = voice ?? "bm_fable";

  // Generate PCM audio
  const result = await kokoro.generate(text, { voice: selectedVoice });
  const samples: Float32Array = result.audio;

  // Convert Float32 PCM → WAV
  const wavBuffer = float32ToWav(samples, 24000);

  // Write WAV to temp file
  const wavPath = join(tmpdir(), `telex-tts-${Date.now()}.wav`);
  writeFileSync(wavPath, wavBuffer);

  try {
    // Convert WAV → OGG Opus via ffmpeg
    const oggBuffer = await wavToOgg(wavPath);
    return oggBuffer;
  } finally {
    safeUnlink(wavPath);
  }
}

// ── Text → Local Speaker ──

export async function speakLocally(
  text: string,
  voice?: string,
): Promise<void> {
  const kokoro = await getKokoro();
  const selectedVoice = voice ?? "bm_fable";

  const result = await kokoro.generate(text, { voice: selectedVoice });
  const samples: Float32Array = result.audio;
  const wavBuffer = float32ToWav(samples, 24000);

  const wavPath = join(tmpdir(), `telex-speak-${Date.now()}.wav`);
  writeFileSync(wavPath, wavBuffer);

  // Play via afplay (macOS), non-blocking
  const child = spawn("afplay", [wavPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  child.on("close", () => safeUnlink(wavPath));
}

// ── Helpers ──

function float32ToWav(samples: Float32Array, sampleRate: number): Buffer {
  const numSamples = samples.length;
  const bytesPerSample = 2; // Int16
  const dataSize = numSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write Int16 samples
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 32768 : clamped * 32767;
    buffer.writeInt16LE(Math.round(int16), 44 + i * 2);
  }

  return buffer;
}

function wavToOgg(wavPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      wavPath,
      "-c:a",
      "libopus",
      "-b:a",
      "64k",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-application",
      "voip",
      "-vbr",
      "off",
      "-f",
      "ogg",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", () => {}); // suppress ffmpeg stderr
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
    ffmpeg.on("error", reject);
  });
}

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
}

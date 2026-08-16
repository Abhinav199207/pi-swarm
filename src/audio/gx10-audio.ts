import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Gx10AudioConfig = {
  aiStackUrl: string;
  sttTimeoutMs: number;
  ttsTimeoutMs: number;
};

export async function transcribeWithParakeet(
  audio: Buffer,
  filename: string,
  config: Gx10AudioConfig,
): Promise<string> {
  const boundary = `----PiGx10Stt${Date.now()}`;
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    "utf8",
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([prefix, audio, suffix]);

  const url = `${config.aiStackUrl.replace(/\/$/, "")}/v1/audio/transcriptions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(config.sttTimeoutMs),
  });

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300);
    throw new Error(`Parakeet STT ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? "").trim();
  if (!text) {
    throw new Error("Parakeet returned empty transcription");
  }
  return text;
}

export async function synthesizeWithChatterbox(
  text: string,
  config: Gx10AudioConfig,
  options?: { language?: string; voice?: string },
): Promise<Buffer> {
  const input = text.trim();
  if (!input) {
    throw new Error("TTS input is empty");
  }

  const url = `${config.aiStackUrl.replace(/\/$/, "")}/v1/audio/speech`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: input.slice(0, 1200),
      language: options?.language ?? "en",
      voice: options?.voice,
      response_format: "wav",
    }),
    signal: AbortSignal.timeout(config.ttsTimeoutMs),
  });

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300);
    throw new Error(`Chatterbox TTS ${res.status}: ${errText}`);
  }

  const wav = Buffer.from(await res.arrayBuffer());
  if (wav.length < 100) {
    throw new Error("Chatterbox returned empty audio");
  }
  return wav;
}

export async function wavToOggOpus(wav: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-gx10-tts-"));
  const wavPath = path.join(dir, "speech.wav");
  const oggPath = path.join(dir, "speech.ogg");
  try {
    await writeFile(wavPath, wav);
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", wavPath, "-c:a", "libopus", "-b:a", "64k", "-ar", "48000", "-ac", "1", oggPath],
      { timeout: 60_000 },
    );
    return await readFile(oggPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function plainTextForTts(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

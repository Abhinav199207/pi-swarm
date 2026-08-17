import path from "node:path";

export function buildMultipartBody(
  fields: Record<string, string>,
  fileField: string,
  fileBuffer: Buffer,
  filename: string,
  mime: string,
): { body: Buffer; boundary: string } {
  const boundary = `----PiTelegram${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        "utf8",
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
      "utf8",
    ),
  );
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
  return { body: Buffer.concat(parts), boundary };
}

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".wav", ".flac", ".aac"]);
const VOICE_EXT = new Set([".ogg", ".opus"]);

export type MediaKind = "video" | "audio" | "voice";

export function mediaKindForPath(filePath: string): MediaKind {
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXT.has(ext)) return "video";
  if (VOICE_EXT.has(ext)) return "voice";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "audio";
}

export function mimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    case ".avi":
      return "video/x-msvideo";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".wav":
      return "audio/wav";
    case ".flac":
      return "audio/flac";
    case ".aac":
      return "audio/aac";
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

export function basenameForPath(filePath: string): string {
  return path.basename(filePath) || "media.bin";
}

import type { TelegramClient, TelegramUpdate } from "./telegram-client.js";
import { TelegramApiError, classifyTelegramError } from "./telegram-client.js";
import {
  basenameForPath,
  buildMultipartBody,
  mimeForPath,
} from "./telegram-multipart.js";

const API_BASE = "https://api.telegram.org";

export class HttpTelegramClient implements TelegramClient {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${API_BASE}/bot${this.token}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      throw classifyTelegramError(res.status, json.description ?? "Telegram API error");
    }
    return json.result as T;
  }

  private async sendMultipart(
    method: string,
    fields: Record<string, string>,
    fileField: string,
    fileBuffer: Buffer,
    filename: string,
  ): Promise<{ messageId: number }> {
    const mime = mimeForPath(filename);
    const { body, boundary } = buildMultipartBody(fields, fileField, fileBuffer, filename, mime);
    const url = `${API_BASE}/bot${this.token}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const json = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
    if (!json.ok) {
      throw classifyTelegramError(res.status, json.description ?? `Telegram ${method} failed`);
    }
    return { messageId: json.result!.message_id };
  }

  async getMe() {
    const me = await this.call<{ id: number; username?: string }>("getMe");
    return { id: String(me.id), username: me.username ?? null };
  }

  async getWebhookInfo() {
    const info = await this.call<{ url?: string }>("getWebhookInfo");
    return { url: info.url ?? "" };
  }

  async getUpdates(input: { offset?: number; timeout: number; allowedUpdates: string[] }) {
    return this.call<TelegramUpdate[]>("getUpdates", {
      offset: input.offset,
      timeout: input.timeout,
      allowed_updates: input.allowedUpdates,
    });
  }

  async sendMessage(input: {
    chatId: string;
    text: string;
    replyToMessageId?: number;
    parseMode?: "MarkdownV2" | "HTML";
  }) {
    const result = await this.call<{ message_id: number }>("sendMessage", {
      chat_id: input.chatId,
      text: input.text,
      reply_to_message_id: input.replyToMessageId,
      parse_mode: input.parseMode,
    });
    return { messageId: result.message_id };
  }

  async sendVoice(input: {
    chatId: string;
    voice: Buffer;
    filename: string;
    replyToMessageId?: number;
    caption?: string;
  }) {
    const fields: Record<string, string> = { chat_id: input.chatId };
    if (input.replyToMessageId != null) {
      fields.reply_to_message_id = String(input.replyToMessageId);
    }
    if (input.caption?.trim()) {
      fields.caption = input.caption.slice(0, 1024);
    }
    return this.sendMultipart("sendVoice", fields, "voice", input.voice, input.filename);
  }

  async sendAudio(input: {
    chatId: string;
    audio: Buffer;
    filename: string;
    replyToMessageId?: number;
    caption?: string;
  }) {
    const fields: Record<string, string> = { chat_id: input.chatId };
    if (input.replyToMessageId != null) {
      fields.reply_to_message_id = String(input.replyToMessageId);
    }
    if (input.caption?.trim()) {
      fields.caption = input.caption.slice(0, 1024);
    }
    return this.sendMultipart("sendAudio", fields, "audio", input.audio, input.filename);
  }

  async sendVideo(input: {
    chatId: string;
    video: Buffer;
    filename: string;
    replyToMessageId?: number;
    caption?: string;
  }) {
    const fields: Record<string, string> = { chat_id: input.chatId };
    if (input.replyToMessageId != null) {
      fields.reply_to_message_id = String(input.replyToMessageId);
    }
    if (input.caption?.trim()) {
      fields.caption = input.caption.slice(0, 1024);
    }
    return this.sendMultipart("sendVideo", fields, "video", input.video, input.filename);
  }

  async downloadFile(fileId: string): Promise<{ buffer: Buffer; filename: string }> {
    const file = await this.call<{ file_path?: string }>("getFile", { file_id: fileId });
    if (!file.file_path) {
      throw new Error("Telegram file path missing");
    }
    const url = `${API_BASE}/file/bot${this.token}/${file.file_path}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      throw new Error(`Telegram file download failed: HTTP ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const filename = basenameForPath(file.file_path);
    return { buffer, filename };
  }

  async sendChatAction(input: {
    chatId: string;
    action: "typing" | "record_voice" | "upload_video";
  }) {
    await this.call<boolean>("sendChatAction", {
      chat_id: input.chatId,
      action: input.action,
    });
  }
}

export class FakeTelegramClient implements TelegramClient {
  sent: Array<{ chatId: string; text: string; replyToMessageId?: number }> = [];
  voices: Array<{ chatId: string; filename: string; replyToMessageId?: number; caption?: string }> = [];
  audios: Array<{ chatId: string; filename: string; replyToMessageId?: number; caption?: string }> = [];
  videos: Array<{ chatId: string; filename: string; replyToMessageId?: number; caption?: string }> = [];
  chatActions: Array<{ chatId: string; action: "typing" | "record_voice" | "upload_video" }> = [];
  updates: TelegramUpdate[] = [];
  webhookUrl = "";
  me = { id: "999", username: "fake_bot" };
  files = new Map<string, Buffer>();

  async getMe() {
    return this.me;
  }

  async getWebhookInfo() {
    return { url: this.webhookUrl };
  }

  async getUpdates() {
    const batch = this.updates.splice(0, this.updates.length);
    return batch;
  }

  async sendMessage(input: { chatId: string; text: string; replyToMessageId?: number }) {
    this.sent.push(input);
    return { messageId: this.sent.length };
  }

  async sendVoice(input: {
    chatId: string;
    voice: Buffer;
    filename: string;
    replyToMessageId?: number;
    caption?: string;
  }) {
    this.voices.push({
      chatId: input.chatId,
      filename: input.filename,
      replyToMessageId: input.replyToMessageId,
      caption: input.caption,
    });
    return { messageId: this.sent.length + this.voices.length };
  }

  async sendAudio(input: {
    chatId: string;
    audio: Buffer;
    filename: string;
    replyToMessageId?: number;
    caption?: string;
  }) {
    this.audios.push({
      chatId: input.chatId,
      filename: input.filename,
      replyToMessageId: input.replyToMessageId,
      caption: input.caption,
    });
    return { messageId: this.sent.length + this.voices.length + this.audios.length };
  }

  async sendVideo(input: {
    chatId: string;
    video: Buffer;
    filename: string;
    replyToMessageId?: number;
    caption?: string;
  }) {
    this.videos.push({
      chatId: input.chatId,
      filename: input.filename,
      replyToMessageId: input.replyToMessageId,
      caption: input.caption,
    });
    return { messageId: this.sent.length + this.voices.length + this.audios.length + this.videos.length };
  }

  async downloadFile(fileId: string) {
    const buffer = this.files.get(fileId);
    if (!buffer) {
      throw new Error(`fake file missing: ${fileId}`);
    }
    return { buffer, filename: `${fileId}.ogg` };
  }

  async sendChatAction(input: { chatId: string; action: "typing" | "record_voice" | "upload_video" }) {
    this.chatActions.push(input);
  }

  enqueueUpdate(update: TelegramUpdate) {
    this.updates.push(update);
  }
}

export function isTelegramApiError(err: unknown): err is TelegramApiError {
  return err instanceof TelegramApiError;
}

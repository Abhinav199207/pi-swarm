import type { TelegramClient, TelegramUpdate } from "./telegram-client.js";
import { TelegramApiError, classifyTelegramError } from "./telegram-client.js";

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

  async sendChatAction(input: { chatId: string; action: "typing" }) {
    await this.call<boolean>("sendChatAction", {
      chat_id: input.chatId,
      action: input.action,
    });
  }
}

export class FakeTelegramClient implements TelegramClient {
  sent: Array<{ chatId: string; text: string; replyToMessageId?: number }> = [];
  chatActions: Array<{ chatId: string; action: "typing" }> = [];
  updates: TelegramUpdate[] = [];
  webhookUrl = "";
  me = { id: "999", username: "fake_bot" };

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

  async sendChatAction(input: { chatId: string; action: "typing" }) {
    this.chatActions.push(input);
  }

  enqueueUpdate(update: TelegramUpdate) {
    this.updates.push(update);
  }
}

export function isTelegramApiError(err: unknown): err is TelegramApiError {
  return err instanceof TelegramApiError;
}

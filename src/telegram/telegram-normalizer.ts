import type { TelegramInboundBody } from "../domain/messages.js";
import type { TelegramUpdate } from "./telegram-client.js";

export function normalizeTelegramUpdate(bridgeId: string, update: TelegramUpdate): TelegramInboundBody | null {
  const receivedAt = new Date().toISOString();

  if (update.message) {
    const msg = update.message;
    const chatType = msg.chat.type as TelegramInboundBody["chatType"];
    const text = msg.text ?? null;
    const command = text?.startsWith("/") ? text.split(/\s+/)[0] ?? null : null;
    if (!msg.from) return null;
    return {
      bridgeId,
      telegramUpdateId: update.update_id,
      telegramMessageId: msg.message_id,
      userId: String(msg.from.id),
      chatId: String(msg.chat.id),
      chatType,
      text,
      command,
      replyToMessageId: msg.reply_to_message?.message_id ?? null,
      receivedAt,
      rawArtifactRef: null,
    };
  }

  if (update.callback_query?.message && update.callback_query.from) {
    const cq = update.callback_query;
    return {
      bridgeId,
      telegramUpdateId: update.update_id,
      telegramMessageId: cq.message?.message_id ?? null,
      userId: String(cq.from.id),
      chatId: String(cq.message!.chat.id),
      chatType: cq.message!.chat.type as TelegramInboundBody["chatType"],
      text: cq.data ?? null,
      command: null,
      replyToMessageId: null,
      receivedAt,
      rawArtifactRef: null,
    };
  }

  return null;
}

export function buildStatusReply(input: {
  personaSlug: string;
  bridgeStatus: string;
  personaStatus: string;
}): string {
  return [
    `Persona: ${input.personaSlug}`,
    `Persona status: ${input.personaStatus}`,
    `Bridge status: ${input.bridgeStatus}`,
  ].join("\n");
}

export function interceptControlCommand(text: string | null): "status" | "help" | "cancel" | null {
  if (!text) return null;
  if (text === "/status") return "status";
  if (text === "/help") return "help";
  if (text.startsWith("/cancel")) return "cancel";
  return null;
}

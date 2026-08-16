import type { TelegramInboundBody } from "../domain/messages.js";
import type { TelegramUpdate } from "./telegram-client.js";

function baseInbound(bridgeId: string, update: TelegramUpdate, msg: NonNullable<TelegramUpdate["message"]>): TelegramInboundBody | null {
  const chatType = msg.chat.type as TelegramInboundBody["chatType"];
  if (!msg.from) return null;
  return {
    bridgeId,
    telegramUpdateId: update.update_id,
    telegramMessageId: msg.message_id,
    userId: String(msg.from.id),
    chatId: String(msg.chat.id),
    chatType,
    text: msg.text ?? null,
    command: msg.text?.startsWith("/") ? msg.text.split(/\s+/)[0] ?? null : null,
    replyToMessageId: msg.reply_to_message?.message_id ?? null,
    receivedAt: new Date().toISOString(),
    rawArtifactRef: null,
    inputModality: "text",
    voiceFileId: null,
    caption: null,
  };
}

export function normalizeTelegramUpdate(bridgeId: string, update: TelegramUpdate): TelegramInboundBody | null {
  if (update.message) {
    const msg = update.message;
    const voice = msg.voice ?? msg.audio;
    if (voice) {
      const base = baseInbound(bridgeId, update, msg);
      if (!base) return null;
      return {
        ...base,
        text: null,
        command: null,
        inputModality: "voice",
        voiceFileId: voice.file_id,
        caption: msg.caption ?? null,
      };
    }

    const base = baseInbound(bridgeId, update, msg);
    if (!base) return null;
    if (!base.text) return null;
    return base;
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
      receivedAt: new Date().toISOString(),
      rawArtifactRef: null,
      inputModality: "text",
      voiceFileId: null,
      caption: null,
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

export function formatVoiceTranscript(transcript: string, caption: string | null | undefined): string {
  const body = transcript.trim();
  const cap = caption?.trim();
  if (cap) {
    return `[voice] ${body}\n\n[caption] ${cap}`;
  }
  return `[voice] ${body}`;
}

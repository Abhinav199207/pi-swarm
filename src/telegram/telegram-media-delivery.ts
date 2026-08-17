import { readFile } from "node:fs/promises";
import type { AppConfig } from "../config.js";
import { plainTextForTts, synthesizeWithChatterbox, wavToOggOpus } from "../audio/gx10-audio.js";
import type { TelegramSendBody } from "../domain/messages.js";
import { getLogger } from "../observability/logger.js";
import type { TelegramClient } from "./telegram-client.js";
import { basenameForPath } from "./telegram-multipart.js";

export type TelegramDeliveryResult = {
  messageId: number;
  delivery: TelegramSendBody["delivery"];
};

export async function deliverTelegramOutbound(
  client: TelegramClient,
  parsed: TelegramSendBody,
  config: AppConfig,
): Promise<TelegramDeliveryResult> {
  const caption = parsed.text?.trim() || undefined;
  const replyTo = parsed.replyToMessageId ?? undefined;
  const parseMode = parsed.parseMode === "plain" ? undefined : parsed.parseMode;

  if (parsed.delivery === "video" && parsed.mediaPath) {
    return sendFileDelivery(client, parsed, "video", caption, replyTo);
  }

  if (parsed.delivery === "audio" && parsed.mediaPath) {
    return sendFileDelivery(client, parsed, "audio", caption, replyTo);
  }

  if (parsed.delivery === "voice" && parsed.mediaPath) {
    return sendFileDelivery(client, parsed, "voice", caption, replyTo);
  }

  if (parsed.delivery === "voice" && config.telegramAudioReplyEnabled) {
    return deliverVoiceTts(client, parsed, config, replyTo, parseMode);
  }

  const result = await client.sendMessage({
    chatId: parsed.chatId,
    text: parsed.text,
    replyToMessageId: replyTo,
    parseMode,
  });
  return { messageId: result.messageId, delivery: "text" };
}

async function sendFileDelivery(
  client: TelegramClient,
  parsed: TelegramSendBody,
  kind: "video" | "audio" | "voice",
  caption: string | undefined,
  replyTo: number | undefined,
): Promise<TelegramDeliveryResult> {
  const mediaPath = parsed.mediaPath!;
  let buffer: Buffer;
  try {
    buffer = await readFile(mediaPath);
  } catch (err) {
    throw new Error(
      `media file not readable: ${mediaPath} (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const filename = basenameForPath(mediaPath);
  if (kind === "video") {
    await client.sendChatAction({ chatId: parsed.chatId, action: "upload_video" });
    const result = await client.sendVideo({
      chatId: parsed.chatId,
      video: buffer,
      filename,
      replyToMessageId: replyTo,
      caption,
    });
    return { messageId: result.messageId, delivery: "video" };
  }

  if (kind === "voice") {
    const result = await client.sendVoice({
      chatId: parsed.chatId,
      voice: buffer,
      filename,
      replyToMessageId: replyTo,
      caption,
    });
    return { messageId: result.messageId, delivery: "voice" };
  }

  const result = await client.sendAudio({
    chatId: parsed.chatId,
    audio: buffer,
    filename,
    replyToMessageId: replyTo,
    caption,
  });
  return { messageId: result.messageId, delivery: "audio" };
}

async function deliverVoiceTts(
  client: TelegramClient,
  parsed: TelegramSendBody,
  config: AppConfig,
  replyTo: number | undefined,
  parseMode: "MarkdownV2" | "HTML" | undefined,
): Promise<TelegramDeliveryResult> {
  const ttsText = plainTextForTts(parsed.text);
  if (!ttsText) {
    const result = await client.sendMessage({
      chatId: parsed.chatId,
      text: parsed.text,
      replyToMessageId: replyTo,
      parseMode,
    });
    return { messageId: result.messageId, delivery: "text" };
  }

  try {
    await client.sendChatAction({ chatId: parsed.chatId, action: "record_voice" });
    const wav = await synthesizeWithChatterbox(ttsText, {
      aiStackUrl: config.aiStackUrl,
      sttTimeoutMs: config.gx10SttTimeoutMs,
      ttsTimeoutMs: config.gx10TtsTimeoutMs,
    });
    let voice = wav;
    let filename = "reply.wav";
    try {
      voice = await wavToOggOpus(wav);
      filename = "reply.ogg";
    } catch {
      getLogger().warn("ffmpeg unavailable; sending voice reply as wav");
    }
    const result = await client.sendVoice({
      chatId: parsed.chatId,
      voice,
      filename,
      replyToMessageId: replyTo,
    });
    return { messageId: result.messageId, delivery: "voice" };
  } catch (err) {
    getLogger().warn(
      { err, chatId: parsed.chatId },
      "gx10 TTS failed; falling back to text reply",
    );
    const result = await client.sendMessage({
      chatId: parsed.chatId,
      text: parsed.text,
      replyToMessageId: replyTo,
      parseMode,
    });
    return { messageId: result.messageId, delivery: "text" };
  }
}

import type { AppConfig } from "../config.js";
import { plainTextForTts, synthesizeWithChatterbox, wavToOggOpus } from "../audio/gx10-audio.js";
import type { TelegramSendBody } from "../domain/messages.js";
import { getLogger } from "../observability/logger.js";
import type { TelegramClient } from "./telegram-client.js";

export async function deliverTelegramOutbound(
  client: TelegramClient,
  parsed: TelegramSendBody,
  config: AppConfig,
): Promise<{ messageId: number; delivery: "text" | "voice" }> {
  if (parsed.delivery !== "voice" || !config.telegramAudioReplyEnabled) {
    const result = await client.sendMessage({
      chatId: parsed.chatId,
      text: parsed.text,
      replyToMessageId: parsed.replyToMessageId ?? undefined,
      parseMode: parsed.parseMode === "plain" ? undefined : parsed.parseMode,
    });
    return { messageId: result.messageId, delivery: "text" };
  }

  const ttsText = plainTextForTts(parsed.text);
  if (!ttsText) {
    const result = await client.sendMessage({
      chatId: parsed.chatId,
      text: parsed.text,
      replyToMessageId: parsed.replyToMessageId ?? undefined,
      parseMode: parsed.parseMode === "plain" ? undefined : parsed.parseMode,
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
      replyToMessageId: parsed.replyToMessageId ?? undefined,
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
      replyToMessageId: parsed.replyToMessageId ?? undefined,
      parseMode: parsed.parseMode === "plain" ? undefined : parsed.parseMode,
    });
    return { messageId: result.messageId, delivery: "text" };
  }
}

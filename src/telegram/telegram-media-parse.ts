import path from "node:path";
import type { TelegramSendBody } from "../domain/messages.js";
import { mediaKindForPath } from "./telegram-multipart.js";

const MEDIA_MARKER = /(?:^|\s)MEDIA:([^\s\n\r]+)/g;

export type OutboundDelivery = TelegramSendBody["delivery"];

export interface ParsedOutboundPart {
  delivery: OutboundDelivery;
  text: string;
  mediaPath?: string;
}

/** Strip MEDIA: markers and split reply into text + optional file deliveries. */
export function parseReplyForOutbound(
  reply: string,
  options: { voiceTts: boolean },
): ParsedOutboundPart[] {
  const mediaPaths: string[] = [];
  let stripped = reply.replace(MEDIA_MARKER, (_match, rawPath: string) => {
    const trimmed = rawPath.trim();
    if (trimmed) mediaPaths.push(trimmed);
    return "";
  });
  stripped = stripped.replace(/\n{3,}/g, "\n\n").trim();

  if (mediaPaths.length > 0) {
    const parts: ParsedOutboundPart[] = [];
    for (let i = 0; i < mediaPaths.length; i++) {
      const mediaPath = path.resolve(mediaPaths[i]!);
      const kind = mediaKindForPath(mediaPath);
      parts.push({
        delivery: kind === "video" ? "video" : kind === "voice" ? "voice" : "audio",
        text: i === 0 ? stripped.slice(0, 1024) : "",
        mediaPath,
      });
    }
    if (stripped && mediaPaths.length > 0 && parts[0] && !parts[0].text) {
      parts[0].text = stripped.slice(0, 1024);
    }
    if (stripped && parts.every((p) => !p.text)) {
      parts[0]!.text = stripped.slice(0, 1024);
    }
    return parts;
  }

  if (options.voiceTts && stripped) {
    return [{ delivery: "voice", text: stripped }];
  }

  if (!stripped) {
    return [{ delivery: "text", text: "(empty message)" }];
  }

  return [{ delivery: "text", text: stripped }];
}

export function buildTelegramSendBodies(
  base: Pick<TelegramSendBody, "bridgeId" | "chatId" | "replyToMessageId" | "parseMode" | "reason">,
  parts: ParsedOutboundPart[],
): TelegramSendBody[] {
  return parts.map((part, index) => ({
    ...base,
    text: part.text,
    delivery: part.delivery,
    mediaPath: part.mediaPath,
    replyToMessageId: index === 0 ? base.replyToMessageId : null,
  }));
}

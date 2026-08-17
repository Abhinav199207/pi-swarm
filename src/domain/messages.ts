import { z } from "zod";

export const AgentMessageKindSchema = z.enum([
  "telegram.inbound",
  "telegram.send",
  "agent.task",
  "agent.question",
  "agent.answer",
  "agent.status",
  "agent.result",
  "agent.cancel",
  "memory.candidate",
]);

export const AgentMessageSchema = z.object({
  id: z.string().uuid(),
  traceId: z.string().uuid(),
  parentMessageId: z.string().uuid().nullable(),
  from: z.string(),
  to: z.string(),
  kind: AgentMessageKindSchema,
  body: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
});

export const TelegramInboundBodySchema = z.object({
  bridgeId: z.string().uuid(),
  telegramUpdateId: z.number().int(),
  telegramMessageId: z.number().int().nullable(),
  userId: z.string(),
  chatId: z.string(),
  chatType: z.enum(["private", "group", "supergroup", "channel"]),
  text: z.string().nullable(),
  command: z.string().nullable(),
  replyToMessageId: z.number().int().nullable(),
  receivedAt: z.string().datetime(),
  rawArtifactRef: z.string().nullable(),
  inputModality: z.enum(["text", "voice"]).default("text"),
  voiceFileId: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
});

export const TelegramSendBodySchema = z
  .object({
    bridgeId: z.string().uuid(),
    chatId: z.string(),
    text: z.string().max(4096).default(""),
    replyToMessageId: z.number().int().nullable(),
    parseMode: z.enum(["MarkdownV2", "HTML", "plain"]).default("plain"),
    reason: z.enum(["reply", "status", "approved_notification"]),
    delivery: z.enum(["text", "voice", "audio", "video"]).default("text"),
    mediaPath: z.string().min(1).optional(),
    progressKey: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.delivery === "text" && !data.text.trim()) {
      ctx.addIssue({ code: "custom", message: "text required for text delivery" });
    }
    if ((data.delivery === "audio" || data.delivery === "video") && !data.mediaPath) {
      ctx.addIssue({ code: "custom", message: "mediaPath required for audio/video delivery" });
    }
  });

export type AgentMessageKind = z.infer<typeof AgentMessageKindSchema>;
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type TelegramInboundBody = z.infer<typeof TelegramInboundBodySchema>;
export type TelegramSendBody = z.infer<typeof TelegramSendBodySchema>;

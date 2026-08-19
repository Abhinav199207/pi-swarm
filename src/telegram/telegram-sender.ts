import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppConfig } from "../config.js";
import type { TelegramSendBody } from "../domain/messages.js";
import { TelegramSendBodySchema } from "../domain/messages.js";
import type { TelegramBridge } from "../domain/persona.js";
import { getDb } from "../persistence/db.js";
import { outboundDeliveryReceipts } from "../persistence/schema.js";
import { AuditRepository } from "../persistence/repositories/audit-repository.js";
import { BridgeRepository } from "../persistence/repositories/bridge-repository.js";
import type { TelegramClient } from "./telegram-client.js";
import { isTelegramApiError } from "./http-telegram-client.js";
import { deliverTelegramOutbound } from "./telegram-media-delivery.js";

export class TelegramSender {
  constructor(
    private readonly bridgeId: string,
    private readonly client: TelegramClient,
    private readonly personaSlug: string,
    private readonly config: AppConfig,
  ) {}

  async processOutboundMessage(messageId: string, body: Record<string, unknown>): Promise<void> {
    const bridge = await loadActiveBridge(this.bridgeId);
    const parsed = TelegramSendBodySchema.parse(body);
    if (bridge.status !== "active") {
      throw new Error("bridge not active");
    }
    if (!parsed.chatId || !bridge.allowedChatIds.includes(parsed.chatId)) {
      throw new Error("chat not allowlisted");
    }
    if (bridge.outboundPolicy === "disabled") {
      throw new Error("outbound disabled");
    }
    if (parsed.reason !== "reply" && parsed.reason !== "status" && bridge.outboundPolicy === "replies_only") {
      throw new Error("only reply reasons allowed");
    }

    const db = getDb();
    const existingReceipt = await db
      .select({ messageId: outboundDeliveryReceipts.messageId })
      .from(outboundDeliveryReceipts)
      .where(eq(outboundDeliveryReceipts.messageId, messageId))
      .limit(1);
    if (existingReceipt.length > 0) return;

    try {
      const result = await deliverTelegramOutbound(this.client, parsed, this.config);

      await db
        .insert(outboundDeliveryReceipts)
        .values({
          id: randomUUID(),
          messageId,
          bridgeId: bridge.id,
          telegramMessageId: result.messageId,
          status: "sent",
          errorCode: null,
          errorMessage: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing({ target: outboundDeliveryReceipts.messageId });

      await new AuditRepository(db).record({
        bridgeId: bridge.id,
        eventType: "telegram.outbound_sent",
        actor: `persona:${this.personaSlug}`,
        payload: { messageId, chatId: parsed.chatId, delivery: result.delivery },
      });
    } catch (err) {
      const code = isTelegramApiError(err) ? err.kind : "unknown";
      await db
        .insert(outboundDeliveryReceipts)
        .values({
          id: randomUUID(),
          messageId,
          bridgeId: bridge.id,
          telegramMessageId: null,
          status: "failed",
          errorCode: code,
          errorMessage: err instanceof Error ? err.message : "send failed",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing({ target: outboundDeliveryReceipts.messageId });
      throw err;
    }
  }
}

export async function loadActiveBridge(bridgeId: string): Promise<TelegramBridge> {
  const bridge = await new BridgeRepository(getDb()).findById(bridgeId);
  if (!bridge) throw new Error("bridge not found");
  return bridge;
}

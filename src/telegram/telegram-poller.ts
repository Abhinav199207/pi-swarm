import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AppConfig } from "../config.js";
import { authorizeTelegramUser } from "../domain/policies.js";
import type { Persona } from "../domain/persona.js";
import type { TelegramBridge } from "../domain/persona.js";
import { TokenConflictError, InvalidTokenError } from "../domain/errors.js";
import { getDb } from "../persistence/db.js";
import { telegramUpdateReceipts } from "../persistence/schema.js";
import { AuditRepository } from "../persistence/repositories/audit-repository.js";
import { BridgeRepository } from "../persistence/repositories/bridge-repository.js";
import { MessageRepository } from "../persistence/repositories/message-repository.js";
import { PersonaRepository } from "../persistence/repositories/persona-repository.js";
import { BridgeLeaseManager } from "./bridge-lease.js";
import { LeaseRepository } from "../persistence/repositories/lease-repository.js";
import type { TelegramClient, TelegramUpdate } from "./telegram-client.js";
import { isTelegramApiError } from "./http-telegram-client.js";
import { buildStatusReply, formatVoiceTranscript, interceptControlCommand, normalizeTelegramUpdate } from "./telegram-normalizer.js";
import { transcribeWithParakeet } from "../audio/gx10-audio.js";
import type { TelegramInboundBody } from "../domain/messages.js";
import { getLogger } from "../observability/logger.js";

export class TelegramPoller {
  private lastRenew = 0;
  private activeEpoch: number | null = null;

  constructor(
    private readonly bridge: TelegramBridge,
    private readonly persona: Persona,
    private readonly client: TelegramClient,
    private readonly lease: BridgeLeaseManager,
    private readonly config: AppConfig,
    private readonly holderId: string,
  ) {}

  async startup(): Promise<void> {
    const log = getLogger();
    const me = await this.client.getMe();
    const db = getDb();
    const bridges = new BridgeRepository(db);
    await bridges.updateBotInfo(this.bridge.id, me.id, me.username);

    const webhook = await this.client.getWebhookInfo();
    if (webhook.url) {
      await bridges.updateStatus(this.bridge.id, "failed");
      throw new Error(`Webhook configured: ${webhook.url}`);
    }

    const { epoch } = await this.lease.acquire(this.bridge.id);
    this.activeEpoch = epoch;
    await bridges.updateStatus(this.bridge.id, "active");
    log.info({ bridgeId: this.bridge.id, epoch }, "telegram poller active");
  }

  async run(signal: AbortSignal): Promise<void> {
    const log = getLogger();
    let lastCommitted = this.bridge.lastCommittedUpdateId;
    let epoch = this.activeEpoch ?? this.bridge.leaseEpoch;

    while (!signal.aborted) {
      try {
        await this.lease.renew(this.bridge.id, epoch);
      } catch {
        log.warn({ bridgeId: this.bridge.id }, "lease lost; stopping poller");
        break;
      }

      let updates: TelegramUpdate[] = [];
      try {
        updates = await this.client.getUpdates({
          offset: lastCommitted == null ? undefined : lastCommitted + 1,
          timeout: this.config.pollLongTimeoutSeconds,
          allowedUpdates: this.bridge.allowedUpdateTypes,
        });
      } catch (err) {
        if (isTelegramApiError(err)) {
          if (err.kind === "conflict") {
            const db = getDb();
            await new BridgeRepository(db).updateStatus(this.bridge.id, "degraded");
            throw new TokenConflictError();
          }
          if (err.kind === "auth") {
            const db = getDb();
            await new BridgeRepository(db).updateStatus(this.bridge.id, "failed");
            throw new InvalidTokenError();
          }
        }
        await sleep(backoffMs());
        continue;
      }

      for (const update of updates) {
        lastCommitted = await this.processUpdate(update, lastCommitted);
      }
    }

    await this.lease.release(this.bridge.id);
  }

  private async processUpdate(update: TelegramUpdate, lastCommitted: number | null): Promise<number | null> {
    const normalized = normalizeTelegramUpdate(this.bridge.id, update);
    if (!normalized) {
      return this.processUpdateTransactionally(update, lastCommitted, null);
    }

    const authorized = authorizeTelegramUser({
      allowedUserIds: this.bridge.allowedUserIds,
      allowedChatIds: this.bridge.allowedChatIds,
      allowGroupChats: this.bridge.allowGroupChats,
      userId: normalized.userId,
      chatId: normalized.chatId,
      chatType: normalized.chatType,
    });

    if (!authorized) {
      return this.processUpdateTransactionally(update, lastCommitted, normalized, { denied: true });
    }

    let enriched = normalized;
    if (
      this.config.telegramAudioEnabled &&
      enriched.inputModality === "voice" &&
      enriched.voiceFileId
    ) {
      try {
        enriched = await this.transcribeVoiceInbound(enriched);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (enriched.telegramMessageId != null) {
          await this.client.sendMessage({
            chatId: enriched.chatId,
            text: `Could not transcribe voice message (gx10 Parakeet): ${message.slice(0, 300)}`,
            replyToMessageId: enriched.telegramMessageId,
          });
        }
        return this.processUpdateTransactionally(update, lastCommitted, null);
      }
    }

    if (!enriched.text?.trim()) {
      return this.processUpdateTransactionally(update, lastCommitted, null);
    }

    const control = interceptControlCommand(enriched.text);
    if (control === "status") {
      enriched = {
        ...enriched,
        text: buildStatusReply({
          personaSlug: this.persona.slug,
          bridgeStatus: this.bridge.status,
          personaStatus: this.persona.status,
        }),
      };
    } else if (control === "help") {
      enriched = {
        ...enriched,
        text: "Supported commands: /status, /help, /cancel <traceId>. Send a voice note to talk via gx10 audio.",
      };
    }

    return this.processUpdateTransactionally(update, lastCommitted, enriched);
  }

  private async transcribeVoiceInbound(body: TelegramInboundBody): Promise<TelegramInboundBody> {
    if (!body.voiceFileId) {
      throw new Error("voice file id missing");
    }
    const { buffer, filename } = await this.client.downloadFile(body.voiceFileId);
    const transcript = await transcribeWithParakeet(buffer, filename, {
      aiStackUrl: this.config.aiStackUrl,
      sttTimeoutMs: this.config.gx10SttTimeoutMs,
      ttsTimeoutMs: this.config.gx10TtsTimeoutMs,
    });
    return {
      ...body,
      text: formatVoiceTranscript(transcript, body.caption),
      inputModality: "voice",
    };
  }

  private async processUpdateTransactionally(
    update: TelegramUpdate,
    lastCommitted: number | null,
    normalized: TelegramInboundBody | null,
    options?: { denied?: boolean },
  ): Promise<number | null> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const bridges = new BridgeRepository(tx);
      const messages = new MessageRepository(tx);
      const audit = new AuditRepository(tx);

      const existing = await tx
        .select()
        .from(telegramUpdateReceipts)
        .where(and(eq(telegramUpdateReceipts.bridgeId, this.bridge.id), eq(telegramUpdateReceipts.updateId, update.update_id)))
        .limit(1);

      if (existing[0]) {
        await bridges.updateLastCommittedUpdateId(this.bridge.id, update.update_id);
        return update.update_id;
      }

      const normalizedBody = normalized;
      if (!normalizedBody) {
        await bridges.updateLastCommittedUpdateId(this.bridge.id, update.update_id);
        await audit.record({
          bridgeId: this.bridge.id,
          personaId: this.persona.id,
          eventType: "telegram.inbound_ignored",
          actor: "telegram-poller",
          payload: { updateId: update.update_id },
        });
        return update.update_id;
      }

      if (options?.denied) {
        await bridges.updateLastCommittedUpdateId(this.bridge.id, update.update_id);
        await audit.record({
          bridgeId: this.bridge.id,
          personaId: this.persona.id,
          eventType: "telegram.inbound_denied",
          actor: "telegram-poller",
          payload: {
            updateId: update.update_id,
            userId: normalizedBody.userId,
            chatId: normalizedBody.chatId,
          },
        });
        return update.update_id;
      }

      const traceId = randomUUID();
      const idempotencyKey = `telegram:${this.bridge.id}:update:${update.update_id}`;
      const { message } = await messages.enqueue({
        traceId,
        from: `telegram:${this.bridge.id}`,
        to: `persona:${this.persona.slug}`,
        kind: "telegram.inbound",
        body: normalizedBody,
        idempotencyKey,
      });

      await tx.insert(telegramUpdateReceipts).values({
        bridgeId: this.bridge.id,
        updateId: update.update_id,
        messageId: message.id,
        receivedAt: new Date(),
      });
      await bridges.updateLastCommittedUpdateId(this.bridge.id, update.update_id);
      await audit.record({
        traceId,
        bridgeId: this.bridge.id,
        personaId: this.persona.id,
        eventType: "telegram.inbound_accepted",
        actor: "telegram-poller",
        payload: { updateId: update.update_id, messageId: message.id },
      });
      return update.update_id;
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(): number {
  return Math.min(60_000, Math.floor(Math.random() * 1000) + 1000);
}

export function createPollerHolderId(): string {
  return `poller-${process.pid}-${randomUUID()}`;
}

export function buildPoller(
  bridge: TelegramBridge,
  persona: Persona,
  client: TelegramClient,
  config: AppConfig,
): TelegramPoller {
  const db = getDb();
  const holderId = createPollerHolderId();
  const lease = new BridgeLeaseManager(
    new LeaseRepository(db),
    new BridgeRepository(db),
    config,
    holderId,
  );
  return new TelegramPoller(bridge, persona, client, lease, config, holderId);
}

export async function loadPersonaForBridge(bridge: TelegramBridge): Promise<Persona> {
  const db = getDb();
  const persona = await new PersonaRepository(db).findById(bridge.personaId);
  if (!persona) throw new Error("persona missing for bridge");
  return persona;
}

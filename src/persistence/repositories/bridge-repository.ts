import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { TelegramBridge } from "../../domain/persona.js";
import { TelegramBridgeSchema } from "../../domain/persona.js";
import type { Db, DbTransaction } from "../db.js";
import { telegramBridges } from "../schema.js";

function rowToBridge(row: typeof telegramBridges.$inferSelect): TelegramBridge {
  return TelegramBridgeSchema.parse({
    id: row.id,
    personaId: row.personaId,
    status: row.status,
    transport: row.transport,
    tokenSecretRef: row.tokenSecretRef,
    tokenFingerprint: row.tokenFingerprint,
    botUserId: row.botUserId,
    botUsername: row.botUsername,
    allowedUserIds: row.allowedUserIds,
    allowedChatIds: row.allowedChatIds,
    allowGroupChats: row.allowGroupChats,
    allowedUpdateTypes: row.allowedUpdateTypes,
    outboundPolicy: row.outboundPolicy,
    lastCommittedUpdateId: row.lastCommittedUpdateId,
    leaseEpoch: row.leaseEpoch,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export class BridgeRepository {
  constructor(private readonly db: Db | DbTransaction) {}

  async create(
    input: Omit<TelegramBridge, "createdAt" | "updatedAt" | "botUserId" | "botUsername" | "lastCommittedUpdateId" | "leaseEpoch" | "lastHeartbeatAt">,
  ): Promise<TelegramBridge> {
    const now = new Date();
    const row = {
      id: input.id,
      personaId: input.personaId,
      status: input.status,
      transport: input.transport,
      tokenSecretRef: input.tokenSecretRef,
      tokenFingerprint: input.tokenFingerprint,
      botUserId: null,
      botUsername: null,
      allowedUserIds: input.allowedUserIds,
      allowedChatIds: input.allowedChatIds,
      allowGroupChats: input.allowGroupChats,
      allowedUpdateTypes: input.allowedUpdateTypes,
      outboundPolicy: input.outboundPolicy,
      lastCommittedUpdateId: null,
      leaseEpoch: 0,
      lastHeartbeatAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(telegramBridges).values(row);
    return rowToBridge(row);
  }

  async findByPersonaId(personaId: string): Promise<TelegramBridge | null> {
    const rows = await this.db.select().from(telegramBridges).where(eq(telegramBridges.personaId, personaId)).limit(1);
    const row = rows[0];
    return row ? rowToBridge(row) : null;
  }

  async findById(id: string): Promise<TelegramBridge | null> {
    const rows = await this.db.select().from(telegramBridges).where(eq(telegramBridges.id, id)).limit(1);
    const row = rows[0];
    return row ? rowToBridge(row) : null;
  }

  async findByFingerprint(fingerprint: string): Promise<TelegramBridge | null> {
    const rows = await this.db.select().from(telegramBridges).where(eq(telegramBridges.tokenFingerprint, fingerprint)).limit(1);
    const row = rows[0];
    return row ? rowToBridge(row) : null;
  }

  async updateStatus(id: string, status: TelegramBridge["status"]): Promise<void> {
    await this.db.update(telegramBridges).set({ status, updatedAt: new Date() }).where(eq(telegramBridges.id, id));
  }

  async updateBotInfo(id: string, botUserId: string, botUsername: string | null): Promise<void> {
    await this.db
      .update(telegramBridges)
      .set({ botUserId, botUsername, updatedAt: new Date() })
      .where(eq(telegramBridges.id, id));
  }

  async updateLastCommittedUpdateId(id: string, updateId: number): Promise<void> {
    await this.db
      .update(telegramBridges)
      .set({ lastCommittedUpdateId: updateId, updatedAt: new Date() })
      .where(eq(telegramBridges.id, id));
  }

  async incrementLeaseEpoch(id: string): Promise<number> {
    const bridge = await this.findById(id);
    if (!bridge) throw new Error("bridge not found");
    const next = bridge.leaseEpoch + 1;
    await this.db.update(telegramBridges).set({ leaseEpoch: next, updatedAt: new Date() }).where(eq(telegramBridges.id, id));
    return next;
  }
}

export function newBridgeId(): string {
  return randomUUID();
}

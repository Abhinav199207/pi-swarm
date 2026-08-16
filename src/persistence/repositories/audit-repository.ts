import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db, DbTransaction } from "../db.js";
import { auditEvents } from "../schema.js";

export class AuditRepository {
  constructor(private readonly db: Db | DbTransaction) {}

  async record(input: {
    traceId?: string | null;
    personaId?: string | null;
    bridgeId?: string | null;
    eventType: string;
    actor: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(auditEvents).values({
      id: randomUUID(),
      traceId: input.traceId ?? null,
      personaId: input.personaId ?? null,
      bridgeId: input.bridgeId ?? null,
      eventType: input.eventType,
      actor: input.actor,
      payload: input.payload,
      createdAt: new Date(),
    });
  }

  async listByBridge(bridgeId: string, limit = 50) {
    return this.db.select().from(auditEvents).where(eq(auditEvents.bridgeId, bridgeId)).limit(limit);
  }
}

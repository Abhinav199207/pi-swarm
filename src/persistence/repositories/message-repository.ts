import { randomUUID } from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import type { AgentMessage } from "../../domain/messages.js";
import { AgentMessageSchema } from "../../domain/messages.js";
import type { Db, DbTransaction } from "../db.js";
import { agentMessages } from "../schema.js";

function rowToMessage(row: typeof agentMessages.$inferSelect): AgentMessage {
  return AgentMessageSchema.parse({
    id: row.id,
    traceId: row.traceId,
    parentMessageId: row.parentMessageId,
    from: row.fromAddress,
    to: row.toAddress,
    kind: row.kind,
    body: row.body,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  });
}

export class MessageRepository {
  constructor(private readonly db: Db | DbTransaction) {}

  async enqueue(input: {
    traceId: string;
    parentMessageId?: string | null;
    from: string;
    to: string;
    kind: AgentMessage["kind"];
    body: Record<string, unknown>;
    idempotencyKey: string;
    expiresAt?: Date | null;
  }): Promise<{ message: AgentMessage; created: boolean }> {
    const existing = await this.db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.toAddress, input.to), eq(agentMessages.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (existing[0]) {
      return { message: rowToMessage(existing[0]), created: false };
    }

    const now = new Date();
    const row = {
      id: randomUUID(),
      traceId: input.traceId,
      parentMessageId: input.parentMessageId ?? null,
      fromAddress: input.from,
      toAddress: input.to,
      kind: input.kind,
      body: input.body,
      idempotencyKey: input.idempotencyKey,
      status: "pending",
      attemptCount: 0,
      availableAt: now,
      createdAt: now,
      processedAt: null,
      expiresAt: input.expiresAt ?? null,
    };
    await this.db.insert(agentMessages).values(row);
    return { message: rowToMessage(row), created: true };
  }

  async claimPending(toAddress: string, limit = 10): Promise<AgentMessage[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.toAddress, toAddress), eq(agentMessages.status, "pending"), lte(agentMessages.availableAt, now)))
      .orderBy(agentMessages.createdAt)
      .limit(limit);
    return rows.map(rowToMessage);
  }

  async markProcessed(id: string): Promise<void> {
    await this.db
      .update(agentMessages)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(agentMessages.id, id));
  }

  async countByToAndIdempotency(to: string, idempotencyKey: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentMessages)
      .where(and(eq(agentMessages.toAddress, to), eq(agentMessages.idempotencyKey, idempotencyKey)));
    return result[0]?.count ?? 0;
  }
}

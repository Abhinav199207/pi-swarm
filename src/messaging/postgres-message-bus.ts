import { randomUUID } from "node:crypto";
import type { AgentMessage } from "../domain/messages.js";
import type { Db } from "../persistence/db.js";
import { MessageRepository } from "../persistence/repositories/message-repository.js";
import type { MessageBus } from "./message-bus.js";

export class PostgresMessageBus implements MessageBus {
  constructor(private readonly db: Db) {}

  async enqueue(input: Omit<AgentMessage, "createdAt"> & { createdAt?: string }) {
    const repo = new MessageRepository(this.db);
    return repo.enqueue({
      traceId: input.traceId,
      parentMessageId: input.parentMessageId,
      from: input.from,
      to: input.to,
      kind: input.kind,
      body: input.body,
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    });
  }

  async claim(toAddress: string, limit = 10): Promise<AgentMessage[]> {
    return new MessageRepository(this.db).claimPending(toAddress, limit);
  }

  async markProcessed(id: string): Promise<void> {
    await new MessageRepository(this.db).markProcessed(id);
  }
}

export function agentTaskMessage(input: {
  fromSlug: string;
  toSlug: string;
  task: string;
  idempotencyKey: string;
}): Omit<AgentMessage, "createdAt"> {
  return {
    id: randomUUID(),
    traceId: randomUUID(),
    parentMessageId: null,
    from: `persona:${input.fromSlug}`,
    to: `persona:${input.toSlug}`,
    kind: "agent.task",
    body: { task: input.task },
    idempotencyKey: input.idempotencyKey,
    expiresAt: null,
  };
}

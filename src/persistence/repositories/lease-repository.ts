import { eq } from "drizzle-orm";
import type { Db, DbTransaction } from "../db.js";
import { bridgeLeases } from "../schema.js";

export class LeaseRepository {
  constructor(private readonly db: Db | DbTransaction) {}

  async get(bridgeId: string) {
    const rows = await this.db.select().from(bridgeLeases).where(eq(bridgeLeases.bridgeId, bridgeId)).limit(1);
    return rows[0] ?? null;
  }

  async upsert(input: { bridgeId: string; holderId: string; epoch: number; expiresAt: Date }): Promise<boolean> {
    const existing = await this.get(input.bridgeId);
    const now = new Date();
    if (!existing) {
      await this.db.insert(bridgeLeases).values({
        bridgeId: input.bridgeId,
        holderId: input.holderId,
        epoch: input.epoch,
        expiresAt: input.expiresAt,
        updatedAt: now,
      });
      return true;
    }
    if (existing.holderId !== input.holderId && existing.expiresAt > now) {
      return false;
    }
    await this.db
      .update(bridgeLeases)
      .set({
        holderId: input.holderId,
        epoch: input.epoch,
        expiresAt: input.expiresAt,
        updatedAt: now,
      })
      .where(eq(bridgeLeases.bridgeId, input.bridgeId));
    return true;
  }

  async release(bridgeId: string, holderId: string): Promise<void> {
    const existing = await this.get(bridgeId);
    if (existing?.holderId === holderId) {
      await this.db.delete(bridgeLeases).where(eq(bridgeLeases.bridgeId, bridgeId));
    }
  }
}

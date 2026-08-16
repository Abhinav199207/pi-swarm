import { randomUUID, createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { MemoryCandidateBody, MemoryDisposition } from "../../domain/memory.js";
import type { Db, DbTransaction } from "../db.js";
import { memoryCandidates, memoryRecallAudit, memoryScopeGrants } from "../schema.js";

export type ScopeGrant = {
  id: string;
  granteeType: "persona" | "run" | "service";
  granteeId: string;
  scopePattern: string;
  canRead: boolean;
  canProposeWrite: boolean;
};

export class MemoryRepository {
  constructor(private readonly db: Db | DbTransaction) {}

  async listActiveGrants(granteeType: string, granteeId: string): Promise<ScopeGrant[]> {
    const rows = await this.db
      .select()
      .from(memoryScopeGrants)
      .where(
        and(
          eq(memoryScopeGrants.granteeType, granteeType),
          eq(memoryScopeGrants.granteeId, granteeId),
          isNull(memoryScopeGrants.revokedAt),
        ),
      );
    return rows.map((row) => ({
      id: row.id,
      granteeType: row.granteeType as ScopeGrant["granteeType"],
      granteeId: row.granteeId,
      scopePattern: row.scopePattern,
      canRead: row.canRead,
      canProposeWrite: row.canProposeWrite,
    }));
  }

  async addGrant(input: Omit<ScopeGrant, "id">): Promise<ScopeGrant> {
    const row = {
      id: randomUUID(),
      granteeType: input.granteeType,
      granteeId: input.granteeId,
      scopePattern: input.scopePattern,
      canRead: input.canRead,
      canProposeWrite: input.canProposeWrite,
      createdAt: new Date(),
      revokedAt: null,
    };
    await this.db.insert(memoryScopeGrants).values(row);
    return { ...input, id: row.id };
  }

  async insertCandidate(input: {
    id: string;
    traceId: string | null;
    sourcePersonaId: string | null;
    sourceRunId: string | null;
    body: MemoryCandidateBody;
    disposition: MemoryDisposition;
    remnicMemoryId?: string | null;
  }): Promise<void> {
    await this.db.insert(memoryCandidates).values({
      id: input.id,
      traceId: input.traceId,
      sourcePersonaId: input.sourcePersonaId,
      sourceRunId: input.sourceRunId,
      scope: input.body.scope,
      kind: input.body.kind,
      sensitivity: input.body.sensitivity,
      statement: input.body.statement,
      rationale: input.body.rationale ?? null,
      provenance: input.body.provenance,
      confidence: input.body.confidence,
      disposition: input.disposition,
      remnicMemoryId: input.remnicMemoryId ?? null,
      expiresAt: null,
      createdAt: new Date(),
      reviewedAt: null,
      reviewedBy: null,
    });
  }

  async findCandidateById(id: string) {
    const rows = await this.db.select().from(memoryCandidates).where(eq(memoryCandidates.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findAcceptedInScope(scope: string) {
    return this.db
      .select()
      .from(memoryCandidates)
      .where(and(eq(memoryCandidates.scope, scope), eq(memoryCandidates.disposition, "auto_accept")));
  }

  async updateCandidateDisposition(
    id: string,
    disposition: MemoryDisposition,
    reviewedBy: string,
    remnicMemoryId?: string | null,
  ): Promise<void> {
    await this.db
      .update(memoryCandidates)
      .set({
        disposition,
        reviewedAt: new Date(),
        reviewedBy,
        remnicMemoryId: remnicMemoryId ?? undefined,
      })
      .where(eq(memoryCandidates.id, id));
  }

  async listCandidatesByDisposition(disposition: MemoryDisposition, limit = 50) {
    return this.db
      .select()
      .from(memoryCandidates)
      .where(eq(memoryCandidates.disposition, disposition))
      .orderBy(desc(memoryCandidates.createdAt))
      .limit(limit);
  }

  async writeRecallAudit(input: {
    requestId: string;
    personaId: string;
    runId: string | null;
    query: string;
    allowedScopes: string[];
    retrievedMemoryIds: string[];
    renderedCharCount: number;
  }): Promise<void> {
    const queryHash = createHash("sha256").update(input.query).digest("hex");
    await this.db.insert(memoryRecallAudit).values({
      id: randomUUID(),
      requestId: input.requestId,
      personaId: input.personaId,
      runId: input.runId,
      queryHash,
      allowedScopes: input.allowedScopes,
      retrievedMemoryIds: input.retrievedMemoryIds,
      renderedCharCount: input.renderedCharCount,
      createdAt: new Date(),
    });
  }
}

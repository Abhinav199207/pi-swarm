import { createHash, randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { AgentMessage } from "../domain/messages.js";
import { MemoryCandidateBodySchema, type MemoryDisposition } from "../domain/memory.js";
import type { Persona } from "../domain/persona.js";
import { MemoryPolicyService } from "./memory-policy-service.js";
import type { MemoryProvider } from "../memory/memory-provider.js";
import { sanitizeMemoryStatement } from "../memory/memory-sanitizer.js";
import { scopeMatches } from "../memory/scope-matcher.js";
import { MemoryRepository } from "../persistence/repositories/memory-repository.js";
import type { Db } from "../persistence/db.js";
import type { MessageBus } from "../messaging/message-bus.js";

export class MemoryCurationService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly provider: MemoryProvider,
    private readonly policy = new MemoryPolicyService(db),
  ) {}

  async processCandidateMessage(message: AgentMessage): Promise<void> {
    const body = MemoryCandidateBodySchema.parse(message.body);
    const sourcePersonaId = message.from.startsWith("persona:")
      ? await this.resolvePersonaId(message.from.slice("persona:".length))
      : null;

    if (sourcePersonaId) {
      const persona = { id: sourcePersonaId, slug: message.from.slice("persona:".length) } as Persona;
      const allowed = await this.policy.canProposeWrite(persona, body.scope);
      if (!allowed) {
        await new MemoryRepository(this.db).insertCandidate({
          id: randomUUID(),
          traceId: message.traceId,
          sourcePersonaId,
          sourceRunId: null,
          body: { ...body, statement: body.statement.slice(0, 200) },
          disposition: "rejected",
        });
        return;
      }
    }

    const sanitized = sanitizeMemoryStatement(body.statement);
    if (!sanitized.ok) {
      await new MemoryRepository(this.db).insertCandidate({
        id: randomUUID(),
        traceId: message.traceId,
        sourcePersonaId,
        sourceRunId: null,
        body: { ...body, statement: `[rejected: ${sanitized.reason}]` },
        disposition: "rejected",
      });
      return;
    }

    const statement = sanitized.text;
    const conflicts = await this.findConflicts(body.scope, statement);
    const disposition = this.chooseDisposition(body, conflicts.length > 0);

    const candidateId = randomUUID();
    let remnicMemoryId: string | null = null;

    if (disposition === "auto_accept") {
      const upsert = await this.provider.upsert({
        externalId: candidateId,
        scope: body.scope,
        kind: body.kind,
        content: statement,
        metadata: {
          sensitivity: body.sensitivity,
          provenance: body.provenance.map((p) => ({ sourceType: p.sourceType, sourceRef: p.sourceRef })),
          confidence: body.confidence,
        },
      });
      remnicMemoryId = upsert.memoryId;
    }

    await new MemoryRepository(this.db).insertCandidate({
      id: candidateId,
      traceId: message.traceId,
      sourcePersonaId,
      sourceRunId: null,
      body: { ...body, statement },
      disposition,
      remnicMemoryId,
    });
  }

  async reviewCandidate(
    candidateId: string,
    approve: boolean,
    reviewedBy: string,
    reason?: string,
  ): Promise<void> {
    const repo = new MemoryRepository(this.db);
    const row = await repo.findCandidateById(candidateId);
    if (!row) throw new Error("candidate not found");

    if (!approve) {
      await repo.updateCandidateDisposition(candidateId, "rejected", reviewedBy);
      return;
    }

    const body = MemoryCandidateBodySchema.parse({
      scope: row.scope,
      kind: row.kind,
      sensitivity: row.sensitivity,
      statement: row.statement,
      rationale: row.rationale,
      provenance: row.provenance,
      confidence: row.confidence,
    });

    const upsert = await this.provider.upsert({
      externalId: candidateId,
      scope: body.scope,
      kind: body.kind,
      content: body.statement,
      metadata: {
        sensitivity: body.sensitivity,
        provenance: body.provenance.map((p) => ({ sourceType: p.sourceType, sourceRef: p.sourceRef })),
        confidence: body.confidence,
      },
    });

    await repo.updateCandidateDisposition(candidateId, "auto_accept", reviewedBy, upsert.memoryId);
    if (reason) void reason;
  }

  async deleteMemory(memoryId: string, reason: string, reviewedBy: string): Promise<void> {
    await this.provider.delete({ memoryId, reason });
    await new MemoryRepository(this.db).insertCandidate({
      id: randomUUID(),
      traceId: null,
      sourcePersonaId: null,
      sourceRunId: null,
      body: {
        scope: "deleted/",
        kind: "correction",
        sensitivity: "internal",
        statement: `Deleted memory ${memoryId}: ${reason}`,
        provenance: [{ sourceType: "manual", sourceRef: reviewedBy, excerpt: null }],
        confidence: 1,
      },
      disposition: "superseded",
      remnicMemoryId: memoryId,
    });
  }

  private chooseDisposition(
    body: { kind: string; sensitivity: string },
    hasConflict: boolean,
  ): MemoryDisposition {
    if (this.config.memoryExtractionRequireReview) return "pending_review";
    if (hasConflict) return "pending_review";
    if (body.sensitivity === "sensitive" || body.sensitivity === "restricted") return "pending_review";
    if (["decision", "hypothesis"].includes(body.kind)) return "pending_review";
    if (["preference", "procedure", "project_convention", "lesson_learned", "correction", "fact"].includes(body.kind)) {
      return "auto_accept";
    }
    return "pending_review";
  }

  private async findConflicts(scope: string, statement: string) {
    const repo = new MemoryRepository(this.db);
    const existing = await repo.findAcceptedInScope(scope);
    const normalized = statement.trim().toLowerCase();
    return existing.filter((row) => {
      const other = row.statement.trim().toLowerCase();
      return other !== normalized && (other.includes("instead of") || normalized.includes("instead of"));
    });
  }

  private async resolvePersonaId(slug: string): Promise<string | null> {
    const { PersonaRepository } = await import("../persistence/repositories/persona-repository.js");
    const persona = await new PersonaRepository(this.db).findBySlug(slug);
    return persona?.id ?? null;
  }
}

export class MemoryCandidateService {
  constructor(
    private readonly bus: MessageBus,
    private readonly policy: MemoryPolicyService,
  ) {}

  async enqueueFromUserMessage(input: {
    persona: Persona;
    message: AgentMessage;
    text: string;
  }): Promise<void> {
    const match = input.text.match(/^(?:please\s+)?remember\s+(?:that\s+)?(.+)/i);
    if (!match?.[1]) return;

    const statement = match[1].trim();
    const sanitized = sanitizeMemoryStatement(statement);
    if (!sanitized.ok) return;

    const scopes = await this.policy.getWriteCandidateScopes(input.persona);
    const scope = scopes.find((s) => s.startsWith(`persona/${input.persona.slug}`)) ?? `persona/${input.persona.slug}/`;
    const hash = createHash("sha256").update(sanitized.text).digest("hex").slice(0, 16);

    await this.bus.enqueue({
      id: randomUUID(),
      traceId: input.message.traceId,
      parentMessageId: input.message.id,
      from: `persona:${input.persona.slug}`,
      to: "service:memory-curator",
      kind: "memory.candidate",
      body: {
        scope,
        kind: "preference",
        sensitivity: "internal",
        statement: sanitized.text,
        rationale: "Explicit user remember request",
        provenance: [
          {
            sourceType: "telegram_message",
            sourceRef: input.message.id,
            excerpt: sanitized.text.slice(0, 200),
          },
        ],
        confidence: 0.95,
      },
      idempotencyKey: `memory-candidate:${input.message.id}:${hash}`,
      expiresAt: null,
    });
  }
}

export function scopeAllowedForPersona(slug: string, scope: string, allowedPatterns: string[]): boolean {
  return allowedPatterns.some((pattern) => scopeMatches(pattern, scope));
}

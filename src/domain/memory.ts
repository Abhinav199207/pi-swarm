import { z } from "zod";

export const MemoryKindSchema = z.enum([
  "preference",
  "fact",
  "decision",
  "procedure",
  "project_convention",
  "lesson_learned",
  "hypothesis",
  "summary",
  "correction",
]);

export const MemorySensitivitySchema = z.enum(["public", "internal", "sensitive", "restricted"]);

export const MemoryDispositionSchema = z.enum([
  "auto_accept",
  "pending_review",
  "rejected",
  "expired",
  "superseded",
]);

export const MemoryScopeSchema = z.string().min(3).max(300);

export const MemoryProvenanceSchema = z.object({
  sourceType: z.enum(["telegram_message", "agent_result", "artifact", "user_approval", "manual"]),
  sourceRef: z.string(),
  excerpt: z.string().max(1000).nullable(),
});

export const MemoryCandidateSchema = z.object({
  id: z.string().uuid(),
  traceId: z.string().uuid().nullable(),
  sourcePersonaId: z.string().uuid().nullable(),
  sourceRunId: z.string().uuid().nullable(),
  scope: MemoryScopeSchema,
  kind: MemoryKindSchema,
  sensitivity: MemorySensitivitySchema,
  statement: z.string().min(1).max(4000),
  rationale: z.string().max(2000).nullable(),
  provenance: z.array(MemoryProvenanceSchema).min(1),
  confidence: z.number().min(0).max(1),
  disposition: MemoryDispositionSchema,
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const MemoryRecallRequestSchema = z.object({
  requestId: z.string().uuid(),
  personaId: z.string().uuid(),
  runId: z.string().uuid().nullable(),
  query: z.string().min(1).max(8000),
  allowedScopes: z.array(MemoryScopeSchema).min(1),
  maxItems: z.number().int().min(1).max(20).default(8),
  maxChars: z.number().int().min(500).max(16000).default(6000),
  includeKinds: z.array(MemoryKindSchema).optional(),
});

export const RecalledMemorySchema = z.object({
  memoryId: z.string(),
  scope: MemoryScopeSchema,
  kind: MemoryKindSchema,
  statement: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  relevanceScore: z.number(),
  provenanceRefs: z.array(z.string()),
  updatedAt: z.string().datetime().nullable(),
});

export const MemoryRecallResultSchema = z.object({
  requestId: z.string().uuid(),
  memories: z.array(RecalledMemorySchema),
  renderedContext: z.string(),
  truncated: z.boolean(),
  retrievedAt: z.string().datetime(),
});

export type MemoryKind = z.infer<typeof MemoryKindSchema>;
export type MemorySensitivity = z.infer<typeof MemorySensitivitySchema>;
export type MemoryDisposition = z.infer<typeof MemoryDispositionSchema>;
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;
export type MemoryRecallRequest = z.infer<typeof MemoryRecallRequestSchema>;
export type RecalledMemory = z.infer<typeof RecalledMemorySchema>;
export type MemoryRecallResult = z.infer<typeof MemoryRecallResultSchema>;

export const MemoryCandidateBodySchema = z.object({
  scope: MemoryScopeSchema,
  kind: MemoryKindSchema,
  sensitivity: MemorySensitivitySchema,
  statement: z.string().min(1).max(4000),
  rationale: z.string().max(2000).nullable().optional(),
  provenance: z.array(MemoryProvenanceSchema).min(1),
  confidence: z.number().min(0).max(1),
});

export type MemoryCandidateBody = z.infer<typeof MemoryCandidateBodySchema>;

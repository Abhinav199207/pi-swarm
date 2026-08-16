import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Persona } from "../../domain/persona.js";
import { PersonaSchema } from "../../domain/persona.js";
import type { Db, DbTransaction } from "../db.js";
import { personas } from "../schema.js";

function rowToPersona(row: typeof personas.$inferSelect): Persona {
  return PersonaSchema.parse({
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    kind: row.kind,
    status: row.status,
    role: row.role,
    systemPromptRef: row.systemPromptRef,
    memoryNamespace: row.memoryNamespace,
    workspaceRef: row.workspaceRef,
    toolProfile: row.toolProfile,
    modelProfile: row.modelProfile,
    inboxTopic: row.inboxTopic,
    outboxTopic: row.outboxTopic,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export class PersonaRepository {
  constructor(private readonly db: Db | DbTransaction) {}

  async create(input: Omit<Persona, "createdAt" | "updatedAt" | "version">): Promise<Persona> {
    const now = new Date();
    const row = {
      id: input.id,
      slug: input.slug,
      displayName: input.displayName,
      kind: input.kind,
      status: input.status,
      role: input.role,
      systemPromptRef: input.systemPromptRef,
      memoryNamespace: input.memoryNamespace,
      workspaceRef: input.workspaceRef,
      toolProfile: input.toolProfile,
      modelProfile: input.modelProfile,
      inboxTopic: input.inboxTopic,
      outboxTopic: input.outboxTopic,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(personas).values(row);
    return rowToPersona(row);
  }

  async findBySlug(slug: string): Promise<Persona | null> {
    const rows = await this.db.select().from(personas).where(eq(personas.slug, slug)).limit(1);
    const row = rows[0];
    return row ? rowToPersona(row) : null;
  }

  async findById(id: string): Promise<Persona | null> {
    const rows = await this.db.select().from(personas).where(eq(personas.id, id)).limit(1);
    const row = rows[0];
    return row ? rowToPersona(row) : null;
  }

  async updateStatus(id: string, status: Persona["status"]): Promise<void> {
    await this.db
      .update(personas)
      .set({ status, updatedAt: new Date() })
      .where(eq(personas.id, id));
  }
}

export function newPersonaId(): string {
  return randomUUID();
}

export function personaTopics(slug: string): { inboxTopic: string; outboxTopic: string } {
  return {
    inboxTopic: `persona.${slug}.inbox`,
    outboxTopic: `persona.${slug}.outbox`,
  };
}

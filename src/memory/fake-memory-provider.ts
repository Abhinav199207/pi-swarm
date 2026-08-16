import type { MemoryProvider, MemoryRecallItem } from "./memory-provider.js";
import { MemoryProviderUnavailableError } from "./memory-errors.js";
import { scopeMatches } from "./scope-matcher.js";

type StoredMemory = MemoryRecallItem & {
  externalId: string;
  sensitivity: string;
  deleted: boolean;
};

export class FakeMemoryProvider implements MemoryProvider {
  private readonly store = new Map<string, StoredMemory>();
  private healthy = true;

  seed(input: {
    memoryId: string;
    scope: string;
    kind: string;
    content: string;
    confidence?: number;
    relevanceScore?: number;
  }): void {
    this.store.set(input.memoryId, {
      memoryId: input.memoryId,
      externalId: input.memoryId,
      scope: input.scope,
      kind: input.kind,
      content: input.content,
      confidence: input.confidence ?? 0.9,
      relevanceScore: input.relevanceScore ?? 1,
      provenanceRefs: [],
      sensitivity: "internal",
      deleted: false,
    });
  }

  setHealthy(value: boolean): void {
    this.healthy = value;
  }

  async recall(input: { query: string; scopes: string[]; maxItems: number }): Promise<MemoryRecallItem[]> {
    if (!this.healthy) {
      throw new MemoryProviderUnavailableError("fake provider unavailable");
    }
    const q = input.query.toLowerCase();
    const results: MemoryRecallItem[] = [];
    for (const item of this.store.values()) {
      if (item.deleted) continue;
      if (!input.scopes.some((pattern) => scopeMatches(pattern, item.scope))) continue;
      const score = item.content.toLowerCase().includes(q) ? 1 : q.length > 3 ? 0.5 : 0.2;
      results.push({ ...item, relevanceScore: score * item.relevanceScore });
    }
    return results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, input.maxItems);
  }

  async upsert(input: {
    externalId: string;
    scope: string;
    kind: string;
    content: string;
    metadata: {
      sensitivity: string;
      provenance: Array<{ sourceType: string; sourceRef: string }>;
      confidence: number;
      expiresAt?: string;
    };
  }): Promise<{ memoryId: string }> {
    const memoryId = input.externalId;
    this.store.set(memoryId, {
      memoryId,
      externalId: input.externalId,
      scope: input.scope,
      kind: input.kind,
      content: input.content,
      confidence: input.metadata.confidence,
      relevanceScore: 1,
      provenanceRefs: input.metadata.provenance.map((p) => p.sourceRef),
      updatedAt: new Date().toISOString(),
      sensitivity: input.metadata.sensitivity,
      deleted: false,
    });
    return { memoryId };
  }

  async correct(input: { memoryId: string; replacement: string }): Promise<void> {
    const item = this.store.get(input.memoryId);
    if (!item) return;
    item.content = input.replacement;
    item.updatedAt = new Date().toISOString();
  }

  async delete(input: { memoryId: string }): Promise<void> {
    const item = this.store.get(input.memoryId);
    if (item) item.deleted = true;
  }

  async healthCheck(): Promise<{ healthy: boolean; detail?: string }> {
    return { healthy: this.healthy, detail: this.healthy ? "ok" : "unhealthy" };
  }
}

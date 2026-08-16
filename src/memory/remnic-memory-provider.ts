import type { MemoryProvider, MemoryRecallItem } from "./memory-provider.js";
import { MemoryProviderUnavailableError } from "./memory-errors.js";
import { scopeMatches } from "./scope-matcher.js";

export type RemnicMemoryProviderOptions = {
  endpoint: string;
  authToken: string;
  timeoutMs?: number;
  searchTool?: string;
  storeTool?: string;
  deleteTool?: string;
};

export class RemnicMemoryProvider implements MemoryProvider {
  constructor(private readonly options: RemnicMemoryProviderOptions) {}

  async recall(input: { query: string; scopes: string[]; maxItems: number }): Promise<MemoryRecallItem[]> {
    const tool = this.options.searchTool ?? "remnic.memory_search";
    const data = await this.callTool(tool, {
      query: input.query,
      maxResults: input.maxItems,
    });
    return normalizeRecallResults(data, input.scopes).slice(0, input.maxItems);
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
    const tool = this.options.storeTool ?? "remnic.memory_store";
    const data = await this.callTool(tool, {
      content: input.content,
      category: input.kind,
      idempotencyKey: input.externalId,
      confidence: input.metadata.confidence,
      ...(input.metadata.provenance[0]?.sourceRef
        ? { sourceReason: input.metadata.provenance[0].sourceRef }
        : {}),
      tags: [input.scope, input.metadata.sensitivity].filter(Boolean),
      ...(input.metadata.expiresAt ? { ttl: input.metadata.expiresAt } : {}),
    });
    const memoryId = extractMemoryId(data) ?? input.externalId;
    return { memoryId };
  }

  async correct(input: { memoryId: string; replacement: string; reason: string }): Promise<void> {
    await this.upsert({
      externalId: input.memoryId,
      scope: "corrected",
      kind: "correction",
      content: input.replacement,
      metadata: {
        sensitivity: "internal",
        provenance: [{ sourceType: "manual", sourceRef: input.reason }],
        confidence: 1,
      },
    });
  }

  async delete(input: { memoryId: string; reason: string }): Promise<void> {
    const tool = this.options.deleteTool ?? "remnic.memory_correct_apply";
    try {
      await this.callTool(tool, { memoryId: input.memoryId, reason: input.reason });
    } catch {
      // Remnic may not expose delete on all builds; best-effort only.
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; detail?: string }> {
    try {
      const res = await fetch(`${this.options.endpoint.replace(/\/$/, "")}/health`, {
        headers: this.options.authToken
          ? { Authorization: `Bearer ${this.options.authToken}` }
          : undefined,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 8000),
      });
      return { healthy: res.ok, detail: `http ${res.status}` };
    } catch (err) {
      return {
        healthy: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    const base = this.options.endpoint.replace(/\/$/, "");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.options.authToken) {
      headers.Authorization = `Bearer ${this.options.authToken}`;
    }

    const attempts: Array<{ url: string; body: unknown }> = [
      {
        url: `${base}/mcp`,
        body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: arguments_ } },
      },
    ];

    let lastError: Error | null = null;
    for (const attempt of attempts) {
      try {
        const res = await fetch(attempt.url, {
          method: "POST",
          headers,
          body: JSON.stringify(attempt.body),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 8000),
        });
        if (!res.ok) {
          lastError = new Error(`Remnic ${attempt.url} returned ${res.status}`);
          continue;
        }
        const payload = (await res.json()) as Record<string, unknown>;
        if (payload.error) {
          lastError = new Error(String((payload.error as { message?: string }).message ?? payload.error));
          continue;
        }
        const result = payload.result ?? payload.data ?? payload;
        return unwrapToolResult(result);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw new MemoryProviderUnavailableError(
      `Remnic tool ${name} failed: ${lastError?.message ?? "unknown"}`,
      lastError,
    );
  }
}

function unwrapToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const obj = result as Record<string, unknown>;
  if (obj.isError === true) {
    const text = mcpText(obj);
    throw new MemoryProviderUnavailableError(text || "Remnic tool returned isError");
  }
  const text = mcpText(obj);
  if (text) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { content: text };
    }
  }
  return result;
}

function mcpText(result: Record<string, unknown>): string {
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) return "";
  const first = content[0];
  if (!first || typeof first !== "object") return "";
  return String((first as { text?: string }).text ?? "");
}

function normalizeRecallResults(data: unknown, allowedScopes: string[]): MemoryRecallItem[] {
  const rawItems = extractArray(data);
  const items: MemoryRecallItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
    const scope = String(row.scope ?? row.namespace ?? tags[0] ?? "");
    if (
      allowedScopes.length > 0 &&
      scope &&
      !allowedScopes.some((p) => scopeMatches(p, scope)) &&
      !tags.some((tag) => allowedScopes.some((p) => scopeMatches(p, tag)))
    ) {
      continue;
    }
    const content = String(row.content ?? row.statement ?? row.text ?? row.snippet ?? "");
    if (!content.trim()) continue;
    items.push({
      memoryId: String(row.memoryId ?? row.id ?? row.memory_id ?? content.slice(0, 32)),
      scope: scope || "unknown/",
      kind: String(row.kind ?? row.type ?? row.category ?? "fact"),
      content,
      confidence: typeof row.confidence === "number" ? row.confidence : undefined,
      relevanceScore:
        typeof row.relevanceScore === "number"
          ? row.relevanceScore
          : typeof row.score === "number"
            ? row.score
            : 0.5,
      provenanceRefs: Array.isArray(row.provenanceRefs)
        ? row.provenanceRefs.map(String)
        : Array.isArray(row.provenance)
          ? (row.provenance as Array<{ sourceRef?: string }>).map((p) => String(p.sourceRef ?? ""))
          : [],
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
    });
  }
  return items;
}

function extractArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  for (const key of ["memories", "results", "items"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  if (typeof obj.context === "string" && obj.context.trim()) {
    return [{ content: obj.context, scope: obj.namespace ?? "default" }];
  }
  return [];
}

function extractMemoryId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const id = obj.memoryId ?? obj.id ?? obj.memory_id;
  return id != null ? String(id) : null;
}

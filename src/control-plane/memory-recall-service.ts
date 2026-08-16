import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { AgentMessage } from "../domain/messages.js";
import { TelegramInboundBodySchema } from "../domain/messages.js";
import type { Persona } from "../domain/persona.js";
import type { MemoryRecallResult } from "../domain/memory.js";
import { MemoryPolicyService } from "./memory-policy-service.js";
import { mapProviderItems, renderRecallContext } from "./memory-recall-renderer.js";
import type { MemoryProvider } from "../memory/memory-provider.js";
import { MemoryProviderUnavailableError } from "../memory/memory-errors.js";
import { sanitizeRecallQuery } from "../memory/memory-sanitizer.js";
import { filterByAllowedScopes } from "../memory/scope-matcher.js";
import { MemoryRepository } from "../persistence/repositories/memory-repository.js";
import type { Db } from "../persistence/db.js";
import { AuditRepository } from "../persistence/repositories/audit-repository.js";
import { getLogger } from "../observability/logger.js";

const CONTROL_COMMANDS = ["/help", "/status", "/cancel", "/approve", "/deny", "/memory"];

export class MemoryRecallService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly provider: MemoryProvider,
    private readonly policy = new MemoryPolicyService(db),
  ) {}

  shouldRecall(message: AgentMessage): boolean {
    if (message.kind === "agent.task" || message.kind === "agent.question") return true;
    if (message.kind !== "telegram.inbound") return false;
    const body = TelegramInboundBodySchema.safeParse(message.body);
    if (!body.success) return false;
    const text = body.data.text?.trim() ?? "";
    if (!text) return false;
    if (!text.startsWith("/")) return true;
    return !CONTROL_COMMANDS.some((cmd) => text.startsWith(cmd));
  }

  buildQuery(message: AgentMessage): string {
    if (message.kind === "telegram.inbound") {
      const body = TelegramInboundBodySchema.parse(message.body);
      return sanitizeRecallQuery(body.text?.trim() ?? "");
    }
    if (message.kind === "agent.task") {
      const task = typeof message.body.task === "string" ? message.body.task : JSON.stringify(message.body);
      return sanitizeRecallQuery(task);
    }
    return sanitizeRecallQuery(JSON.stringify(message.body));
  }

  async recallForMessage(input: {
    persona: Persona;
    message: AgentMessage;
    runId?: string | null;
  }): Promise<MemoryRecallResult> {
    const requestId = randomUUID();
    const allowedScopes = await this.policy.getReadScopes(input.persona, input.runId ?? null);
    const query = this.buildQuery(input.message);
    const empty: MemoryRecallResult = {
      requestId,
      memories: [],
      renderedContext: "",
      truncated: false,
      retrievedAt: new Date().toISOString(),
    };

    if (!query.trim()) return empty;

    try {
      const raw = await this.provider.recall({
        query,
        scopes: allowedScopes,
        maxItems: this.config.memoryRecallMaxItems,
      });
      const mapped = mapProviderItems(raw);
      const scoped = filterByAllowedScopes(mapped, allowedScopes);
      const seen = new Set<string>();
      const deduped = scoped.filter((m) => {
        const key = m.statement.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const { renderedContext, truncated, selected } = renderRecallContext(
        deduped,
        this.config.memoryRecallMaxItems,
        this.config.memoryRecallMaxChars,
      );

      await new MemoryRepository(this.db).writeRecallAudit({
        requestId,
        personaId: input.persona.id,
        runId: input.runId ?? null,
        query,
        allowedScopes,
        retrievedMemoryIds: selected.map((m) => m.memoryId),
        renderedCharCount: renderedContext.length,
      });

      return {
        requestId,
        memories: selected,
        renderedContext,
        truncated,
        retrievedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (err instanceof MemoryProviderUnavailableError) {
        getLogger().warn({ err, persona: input.persona.slug }, "memory recall unavailable");
        await new AuditRepository(this.db).record({
          traceId: input.message.traceId,
          personaId: input.persona.id,
          bridgeId: null,
          eventType: "memory.recall_unavailable",
          actor: `persona:${input.persona.slug}`,
          payload: { requestId, detail: err.message },
        });
        return empty;
      }
      throw err;
    }
  }
}

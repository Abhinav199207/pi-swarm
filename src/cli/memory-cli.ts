import type { AppConfig } from "../config.js";
import { getDb } from "../persistence/db.js";
import { MemoryRepository } from "../persistence/repositories/memory-repository.js";
import { PersonaRepository } from "../persistence/repositories/persona-repository.js";
import { MemoryRuntime } from "../memory/memory-runtime.js";
import { PostgresMessageBus } from "../messaging/postgres-message-bus.js";
import { scopeAllowedForPersona } from "../control-plane/memory-curation-service.js";
import { createMemoryProvider } from "../memory/memory-provider.js";
import { MemoryCurationService } from "../control-plane/memory-curation-service.js";

export async function runMemoryCli(argv: string[], config: AppConfig): Promise<void> {
  const [, , , action] = argv;
  if (!action) memoryUsage();

  const db = getDb();
  const bus = new PostgresMessageBus(db);
  const runtime = new MemoryRuntime(db, config, bus);
  const repo = new MemoryRepository(db);

  if (action === "list") {
    const scope = requireFlag("--scope");
    const provider = createMemoryProvider({
      provider: config.memoryProvider,
      remnicEndpoint: config.remnicEndpoint,
      remnicAuthToken: config.remnicAuthToken,
    });
    const items = await provider.recall({ query: scope, scopes: [scope], maxItems: 20 });
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (action === "search") {
    const scope = requireFlag("--scope");
    const query = requireFlag("--query");
    const provider = createMemoryProvider({
      provider: config.memoryProvider,
      remnicEndpoint: config.remnicEndpoint,
      remnicAuthToken: config.remnicAuthToken,
    });
    const items = await provider.recall({ query, scopes: [scope], maxItems: 20 });
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (action === "review") {
    const candidateId = requireFlag("--candidate");
    const curation = new MemoryCurationService(db, config, runtime.provider);
    if (argv.includes("--approve")) {
      await curation.reviewCandidate(candidateId, true, "cli");
      console.log(`approved ${candidateId}`);
      return;
    }
    if (argv.includes("--reject")) {
      const reasonIdx = argv.indexOf("--reason");
      const reason = reasonIdx >= 0 ? argv[reasonIdx + 1] : "cli reject";
      await curation.reviewCandidate(candidateId, false, "cli", reason);
      console.log(`rejected ${candidateId}`);
      return;
    }
    memoryUsage();
  }

  if (action === "delete") {
    const memoryId = requireFlag("--memory");
    const reason = requireFlag("--reason");
    await runtime.curation.deleteMemory(memoryId, reason, "cli");
    console.log(`deleted ${memoryId}`);
    return;
  }

  if (action === "grants") {
    const sub = argv[4];
    if (sub === "list") {
      const slug = requireFlag("--persona");
      const persona = await new PersonaRepository(db).findBySlug(slug);
      if (!persona) throw new Error(`persona not found: ${slug}`);
      const grants = await repo.listActiveGrants("persona", persona.id);
      console.log(JSON.stringify(grants, null, 2));
      return;
    }
    if (sub === "add") {
      const slug = requireFlag("--persona");
      const persona = await new PersonaRepository(db).findBySlug(slug);
      if (!persona) throw new Error(`persona not found: ${slug}`);
      const readScope = argFlag("--read");
      const writeScope = argFlag("--write");
      if (readScope) {
        await repo.addGrant({
          granteeType: "persona",
          granteeId: persona.id,
          scopePattern: readScope,
          canRead: true,
          canProposeWrite: false,
        });
      }
      if (writeScope) {
        await repo.addGrant({
          granteeType: "persona",
          granteeId: persona.id,
          scopePattern: writeScope,
          canRead: false,
          canProposeWrite: true,
        });
      }
      console.log("grant added");
      return;
    }
  }

  if (action === "pending") {
    const pending = await repo.listCandidatesByDisposition("pending_review", 50);
    console.log(JSON.stringify(pending, null, 2));
    return;
  }

  memoryUsage();
}

function requireFlag(name: string): string {
  const value = argFlag(name);
  if (!value) memoryUsage();
  return value;
}

function argFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function memoryUsage(): never {
  console.log(`Usage:
  npm run cli -- memory list --scope persona/atlas-infra/
  npm run cli -- memory search --scope project/pi-swarm/ --query "deployment rollback"
  npm run cli -- memory pending
  npm run cli -- memory review --candidate <id> --approve
  npm run cli -- memory review --candidate <id> --reject --reason "..."
  npm run cli -- memory delete --memory <id> --reason "..."
  npm run cli -- memory grants list --persona atlas-infra
  npm run cli -- memory grants add --persona atlas-infra --read project/homelab/*`);
  process.exit(1);
}

export { scopeAllowedForPersona };

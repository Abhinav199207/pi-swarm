import "dotenv/config";
import { loadConfig } from "./config.js";
import { getDb, closeDb } from "./persistence/db.js";
import { runMigrations } from "./persistence/migrate.js";
import { getLogger } from "./observability/logger.js";
import { PersonaRepository } from "./persistence/repositories/persona-repository.js";
import { LifecycleService } from "./control-plane/persona-service.js";
import { PersonaSupervisor } from "./runtime/persona-supervisor.js";
import { PostgresMessageBus } from "./messaging/postgres-message-bus.js";
import { MemoryCurationWorker } from "./messaging/memory-curation-worker.js";
import { MemoryRuntime } from "./memory/memory-runtime.js";

async function main() {
  const config = loadConfig();
  const log = getLogger();
  await runMigrations();
  const db = getDb();
  const bus = new PostgresMessageBus(db);
  const memoryRuntime = new MemoryRuntime(db, config, bus);
  const supervisor = new PersonaSupervisor(config, memoryRuntime);
  const lifecycle = new LifecycleService(db);
  const personas = new PersonaRepository(db);
  const started: string[] = [];

  const curationController = new AbortController();
  if (config.memoryExtractionEnabled) {
    const curationWorker = new MemoryCurationWorker(
      bus,
      memoryRuntime.curation,
      config.memoryCurationPollIntervalMs,
    );
    void curationWorker.run(curationController.signal).catch((err) => {
      log.error({ err }, "memory curation worker stopped");
    });
  }

  const slugs = (process.env.PERSONA_SLUGS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const slug of slugs) {
    const persona = await personas.findBySlug(slug);
    if (!persona) {
      log.warn({ slug }, "persona not found; skipping");
      continue;
    }
    await memoryRuntime.policy.seedDefaultGrants(persona);
    await lifecycle.startPersona(persona.id);
    await supervisor.start(persona.id);
    started.push(slug);
  }

  log.info({ nodeEnv: config.nodeEnv, personas: started }, "pi-swarm control plane ready");

  const shutdown = async (reason: string) => {
    log.info({ reason }, "shutting down");
    curationController.abort();
    for (const slug of started) {
      const persona = await personas.findBySlug(slug);
      if (!persona) continue;
      await supervisor.stop(persona.id, reason);
      await lifecycle.stopPersona(persona.id, reason);
    }
    await closeDb();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("sigint"));
  process.on("SIGTERM", () => void shutdown("sigterm"));

  await new Promise<void>(() => undefined);
}

main().catch(async (err) => {
  getLogger().error({ err }, "startup failed");
  await closeDb();
  process.exit(1);
});

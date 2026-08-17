#!/usr/bin/env node
import "dotenv/config";
import { loadConfig } from "../config.js";
import { getDb, closeDb } from "../persistence/db.js";
import { runMigrations } from "../persistence/migrate.js";
import { BridgeService, LifecycleService, PersonaService } from "../control-plane/persona-service.js";
import { PersonaRepository } from "../persistence/repositories/persona-repository.js";
import { PersonaSupervisor } from "../runtime/persona-supervisor.js";
import { runMemoryCli } from "./memory-cli.js";
import { MemoryRuntime } from "../memory/memory-runtime.js";
import { PostgresMessageBus } from "../messaging/postgres-message-bus.js";

function usage(): never {
  console.log(`Usage:
  npm run cli -- persona create --slug <slug> --name <name> --role <role> --prompt <ref> --memory <ns> --workspace <path> --tools <profile> --model <profile> [--kind concierge|persistent_persona]
  npm run cli -- persona telegram-enable --persona <slug> --token-secret <ref> --allow-user <id> --allow-chat <id> [--allow-group-chats] [--outbound replies_only|disabled|allowlisted_only]
  npm run cli -- persona start <slug>
  npm run cli -- persona stop <slug> [--reason text]
  npm run cli -- persona status <slug>
  npm run cli -- memory list --scope <scope>
  npm run cli -- db migrate`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function requireArg(name: string): string {
  const value = arg(name);
  if (!value) usage();
  return value;
}

async function getPersonaBySlug(db: ReturnType<typeof getDb>, slug: string) {
  const repo = new PersonaRepository(db);
  const existing = await repo.findBySlug(slug);
  if (existing) return existing;
  throw new Error(`Persona not found: ${slug}. Create it first with persona create.`);
}

async function main() {
  const [, , domain, action, positional] = process.argv;
  if (!domain) usage();

  const config = loadConfig();
  await runMigrations();
  const db = getDb();

  if (domain === "db" && action === "migrate") {
    console.log("migrations applied");
    await closeDb();
    return;
  }

  if (domain === "memory") {
    await runMemoryCli(process.argv, config);
    await closeDb();
    return;
  }

  if (domain !== "persona" || !action) usage();

  const personas = new PersonaService(db);
  const bridges = new BridgeService(db, config);
  const lifecycle = new LifecycleService(db);
  const bus = new PostgresMessageBus(db);
  const memoryRuntime = new MemoryRuntime(db, config, bus);
  const supervisor = new PersonaSupervisor(config, memoryRuntime);

  if (action === "create") {
    const persona = await personas.createPersistentPersona({
      slug: requireArg("--slug"),
      displayName: requireArg("--name"),
      role: requireArg("--role"),
      systemPromptRef: requireArg("--prompt"),
      memoryNamespace: requireArg("--memory"),
      workspaceRef: requireArg("--workspace"),
      toolProfile: requireArg("--tools"),
      modelProfile: requireArg("--model"),
      kind: arg("--kind") as "concierge" | "persistent_persona" | undefined,
    });
    console.log(JSON.stringify(persona, null, 2));
    await closeDb();
    return;
  }

  if (action === "telegram-enable") {
    const slug = requireArg("--persona");
    const persona = await getPersonaBySlug(db, slug);
    const bridge = await bridges.enableTelegramBridge({
      personaId: persona.id,
      tokenSecretRef: requireArg("--token-secret"),
      allowedUserIds: [requireArg("--allow-user")],
      allowedChatIds: [requireArg("--allow-chat")],
      allowGroupChats: process.argv.includes("--allow-group-chats"),
      outboundPolicy: (arg("--outbound") ?? "replies_only") as "disabled" | "replies_only" | "allowlisted_only",
    });
    console.log(JSON.stringify(bridge, null, 2));
    await closeDb();
    return;
  }

  const slug = positional ?? arg("--persona");
  if (!slug) usage();
  const persona = await getPersonaBySlug(db, slug);

  if (action === "start") {
    await lifecycle.startPersona(persona.id);
    await supervisor.start(persona.id);
    console.log(`started ${slug} (Ctrl+C to stop)`);
    await new Promise<void>((resolve) => {
      const onSignal = () => resolve();
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    });
    await supervisor.stop(persona.id, "signal");
    await lifecycle.stopPersona(persona.id, "signal");
    await closeDb();
    return;
  }

  if (action === "stop") {
    const reason = arg("--reason") ?? "cli";
    await supervisor.stop(persona.id, reason);
    await lifecycle.stopPersona(persona.id, reason);
    console.log(`stopped ${slug}`);
    await closeDb();
    return;
  }

  if (action === "status") {
    const health = await supervisor.getHealth(persona.id);
    console.log(JSON.stringify(health, null, 2));
    await closeDb();
    return;
  }

  usage();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closeDb();
  process.exit(1);
});

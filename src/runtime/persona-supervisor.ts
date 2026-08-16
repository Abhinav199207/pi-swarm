import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { AgentMessage } from "../domain/messages.js";
import type { Persona } from "../domain/persona.js";
import type { TelegramBridge } from "../domain/persona.js";
import { getDb } from "../persistence/db.js";
import { BridgeRepository } from "../persistence/repositories/bridge-repository.js";
import { PersonaRepository } from "../persistence/repositories/persona-repository.js";
import { EnvSecretProvider } from "../secrets/env-secret-provider.js";
import { HttpTelegramClient } from "../telegram/http-telegram-client.js";
import { buildPoller } from "../telegram/telegram-poller.js";
import { TelegramSender } from "../telegram/telegram-sender.js";
import { startTelegramTyping, type TelegramTypingHandle } from "../telegram/telegram-typing.js";
import { TelegramInboundBodySchema } from "../domain/messages.js";
import { InboxWorker } from "../messaging/inbox-worker.js";
import { OutboxWorker } from "../messaging/outbox-worker.js";
import { PostgresMessageBus } from "../messaging/postgres-message-bus.js";
import { processInboxMessage } from "./inbox-processor.js";
import { processMemoryCommands } from "./memory-commands.js";
import { newPersonaWorker, type PersonaWorker, type PersonaWorkerEvent } from "./pi-rpc-worker.js";
import type { MemoryRuntime } from "../memory/memory-runtime.js";
import { MemoryRepository } from "../persistence/repositories/memory-repository.js";
import { getLogger } from "../observability/logger.js";

export type PersonaHealth = {
  personaId: string;
  slug: string;
  status: Persona["status"];
  bridgeStatus: TelegramBridge["status"] | "none";
  workerHealthy: boolean;
};

type PersonaRuntime = {
  worker: PersonaWorker;
  workerController: AbortController;
  inboxController: AbortController;
  outboxController: AbortController | null;
  pollerController: AbortController | null;
};

export class PersonaSupervisor {
  private runtimes = new Map<string, PersonaRuntime>();
  private bridgeClients = new Map<string, HttpTelegramClient>();

  constructor(
    private readonly config: AppConfig,
    private readonly memoryRuntime?: MemoryRuntime,
    private readonly workerFactory: (persona: Persona) => PersonaWorker = (persona) =>
      newPersonaWorker(config, memoryRuntime ? { recall: memoryRuntime.recall, candidates: memoryRuntime.candidates } : undefined),
  ) {}

  async start(personaId: string): Promise<void> {
    if (this.runtimes.has(personaId)) return;

    const db = getDb();
    const personas = new PersonaRepository(db);
    const persona = await personas.findById(personaId);
    if (!persona) throw new Error("persona not found");

    await personas.updateStatus(personaId, "starting");
    const bus = new PostgresMessageBus(db);
    const bridge = await new BridgeRepository(db).findByPersonaId(personaId);

    const workerController = new AbortController();
    const inboxController = new AbortController();
    const worker = this.workerFactory(persona);

    let outboxController: AbortController | null = null;
    let pollerController: AbortController | null = null;

    if (bridge && ["starting", "active", "provisioning", "degraded"].includes(bridge.status)) {
      if (bridge.status === "degraded") {
        await new BridgeRepository(db).updateStatus(bridge.id, "starting");
      }
      const controllers = await this.startBridgeWorkers(bridge, persona, bus);
      outboxController = controllers.outboxController;
      pollerController = controllers.pollerController;
    }

    void worker.start({
      persona,
      signal: workerController.signal,
      onEvent: async (event) => {
        await this.handleWorkerEvent(persona, bridge, bus, event);
      },
    });

    const inboxWorker = new InboxWorker(bus, persona, async (message: AgentMessage) => {
      await this.dispatchInboxMessage(persona, bridge, bus, message);
    });
    void inboxWorker.run(inboxController.signal).catch((err) => {
      getLogger().error({ err, personaId }, "inbox worker stopped");
    });

    this.runtimes.set(personaId, {
      worker,
      workerController,
      inboxController,
      outboxController,
      pollerController,
    });

    await personas.updateStatus(personaId, "running");
    getLogger().info({ personaId, slug: persona.slug, bridge: bridge?.status ?? "none" }, "persona started");
  }

  async stop(personaId: string, reason: string): Promise<void> {
    const runtime = this.runtimes.get(personaId);
    if (runtime) {
      runtime.pollerController?.abort();
      runtime.outboxController?.abort();
      runtime.inboxController.abort();
      runtime.workerController.abort();
      await runtime.worker.stop();
      this.runtimes.delete(personaId);
    }
    const bridge = await new BridgeRepository(getDb()).findByPersonaId(personaId);
    if (bridge) this.bridgeClients.delete(bridge.id);
    await new PersonaRepository(getDb()).updateStatus(personaId, "stopped");
    getLogger().info({ personaId, reason }, "persona stopped");
  }

  async restart(personaId: string, reason: string): Promise<void> {
    await this.stop(personaId, reason);
    await this.start(personaId);
  }

  async getHealth(personaId: string): Promise<PersonaHealth> {
    const db = getDb();
    const persona = await new PersonaRepository(db).findById(personaId);
    if (!persona) throw new Error("persona not found");
    const bridge = await new BridgeRepository(db).findByPersonaId(personaId);
    const worker = this.runtimes.get(personaId)?.worker;
    return {
      personaId,
      slug: persona.slug,
      status: persona.status,
      bridgeStatus: bridge?.status ?? "none",
      workerHealthy: worker ? await worker.isHealthy() : false,
    };
  }

  private async dispatchInboxMessage(
    persona: Persona,
    bridge: TelegramBridge | null,
    bus: PostgresMessageBus,
    message: AgentMessage,
  ): Promise<void> {
    const typing = this.startTypingIfNeeded(message, bridge);
    try {
      if (this.memoryRuntime) {
        const memoryRepo = new MemoryRepository(getDb());
        const memoryEvents = await processMemoryCommands(persona, message, memoryRepo, async (id, approve) => {
          await this.memoryRuntime!.curation.reviewCandidate(id, approve, `persona:${persona.slug}`);
        });
        if (memoryEvents.length > 0) {
          for (const event of memoryEvents) {
            await this.handleWorkerEvent(persona, bridge, bus, event, message.traceId, message.id);
          }
          return;
        }
      }

      const runtime = this.runtimes.get(persona.id);
      const worker = runtime?.worker;
      const emit = async (event: PersonaWorkerEvent) => {
        await this.handleWorkerEvent(persona, bridge, bus, event, message.traceId, message.id);
      };
      const events =
        worker?.handleInboxMessage != null
          ? await worker.handleInboxMessage(persona, message, emit)
          : processInboxMessage(persona, message);
      for (const event of events) {
        await this.handleWorkerEvent(persona, bridge, bus, event, message.traceId, message.id);
      }
    } finally {
      typing?.stop();
    }
  }

  private startTypingIfNeeded(message: AgentMessage, bridge: TelegramBridge | null): TelegramTypingHandle | null {
    if (!this.config.telegramTypingEnabled) return null;
    if (message.kind !== "telegram.inbound" || !bridge || bridge.status !== "active") return null;

    const body = TelegramInboundBodySchema.safeParse(message.body);
    if (!body.success || !bridge.allowedChatIds.includes(body.data.chatId)) return null;

    const client = this.bridgeClients.get(bridge.id);
    if (!client) return null;

    return startTelegramTyping(client, body.data.chatId, this.config.telegramTypingRefreshMs);
  }

  private async handleWorkerEvent(
    persona: Persona,
    bridge: TelegramBridge | null,
    bus: PostgresMessageBus,
    event: PersonaWorkerEvent,
    traceId?: string,
    parentMessageId?: string,
  ): Promise<void> {
    if (event.type === "status") {
      getLogger().info({ slug: persona.slug, message: event.message }, "persona status");
      return;
    }

    if (event.type === "telegram.send") {
      if (!bridge) {
        getLogger().warn({ slug: persona.slug }, "telegram.send ignored: no bridge");
        return;
      }
      const progressKey =
        typeof event.body.progressKey === "string" ? event.body.progressKey : undefined;
      const reason = typeof event.body.reason === "string" ? event.body.reason : "reply";
      const parentId = parentMessageId ?? null;

      await bus.enqueue({
        id: randomUUID(),
        traceId: traceId ?? randomUUID(),
        parentMessageId: parentId,
        from: `persona:${persona.slug}`,
        to: `bridge:${bridge.id}`,
        kind: "telegram.send",
        body: event.body,
        idempotencyKey:
          progressKey ?? (parentId && reason === "reply" ? `reply:${parentId}` : randomUUID()),
        expiresAt: null,
      });
    }
  }

  private async startBridgeWorkers(
    bridge: TelegramBridge,
    persona: Persona,
    bus: PostgresMessageBus,
  ): Promise<{ outboxController: AbortController; pollerController: AbortController }> {
    const secrets = new EnvSecretProvider();
    const token = await secrets.resolve(bridge.tokenSecretRef);
    const client = new HttpTelegramClient(token);
    this.bridgeClients.set(bridge.id, client);
    const sender = new TelegramSender(bridge.id, client, persona.slug, this.config);

    const outboxController = new AbortController();
    const outboxWorker = new OutboxWorker(bus, bridge, sender);
    void outboxWorker.run(outboxController.signal).catch((err) => {
      getLogger().error({ err, bridgeId: bridge.id }, "outbox worker stopped");
    });

    const pollerController = new AbortController();
    void this.runPollerLoop(bridge.id, persona, client, pollerController).catch((err) => {
      getLogger().error({ err, bridgeId: bridge.id }, "poller loop stopped");
    });

    return { outboxController, pollerController };
  }

  private async runPollerLoop(
    bridgeId: string,
    persona: Persona,
    client: HttpTelegramClient,
    controller: AbortController,
  ): Promise<void> {
    const log = getLogger();
    while (!controller.signal.aborted) {
      const db = getDb();
      const bridges = new BridgeRepository(db);
      let bridge = await bridges.findById(bridgeId);
      if (!bridge || !["starting", "active", "provisioning", "degraded"].includes(bridge.status)) {
        return;
      }
      if (bridge.status === "degraded") {
        await bridges.updateStatus(bridgeId, "starting");
        bridge = (await bridges.findById(bridgeId))!;
      }

      const poller = buildPoller(bridge, persona, client, this.config);
      try {
        await poller.startup();
        await poller.run(controller.signal);
        return;
      } catch (err) {
        log.error({ err, bridgeId }, "poller stopped; retrying");
        if (controller.signal.aborted) return;
        await sleep(8000);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { Persona } from "../domain/persona.js";
import {
  DuplicateTokenFingerprintError,
  EphemeralTelegramForbiddenError,
  PersonaNotFoundError,
  WebhookConfiguredError,
} from "../domain/errors.js";
import type { Db } from "../persistence/db.js";
import { AuditRepository } from "../persistence/repositories/audit-repository.js";
import { BridgeRepository, newBridgeId } from "../persistence/repositories/bridge-repository.js";
import { PersonaRepository, newPersonaId, personaTopics } from "../persistence/repositories/persona-repository.js";
import { EnvSecretProvider, fingerprintToken } from "../secrets/env-secret-provider.js";
import { HttpTelegramClient } from "../telegram/http-telegram-client.js";

export class PersonaService {
  constructor(private readonly db: Db) {}

  async createPersistentPersona(input: {
    slug: string;
    displayName: string;
    role: string;
    systemPromptRef: string;
    memoryNamespace: string;
    workspaceRef: string;
    toolProfile: string;
    modelProfile: string;
    kind?: Persona["kind"];
  }): Promise<Persona> {
    const repo = new PersonaRepository(this.db);
    const existing = await repo.findBySlug(input.slug);
    if (existing) return existing;

    const topics = personaTopics(input.slug);
    return repo.create({
      id: newPersonaId(),
      slug: input.slug,
      displayName: input.displayName,
      kind: input.kind ?? "persistent_persona",
      status: "created",
      role: input.role,
      systemPromptRef: input.systemPromptRef,
      memoryNamespace: input.memoryNamespace,
      workspaceRef: input.workspaceRef,
      toolProfile: input.toolProfile,
      modelProfile: input.modelProfile,
      inboxTopic: topics.inboxTopic,
      outboxTopic: topics.outboxTopic,
    });
  }
}

export class BridgeService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  async enableTelegramBridge(input: {
    personaId: string;
    tokenSecretRef: string;
    allowedUserIds: string[];
    allowedChatIds: string[];
    allowGroupChats?: boolean;
    outboundPolicy: "disabled" | "replies_only" | "allowlisted_only";
  }) {
    const personas = new PersonaRepository(this.db);
    const bridges = new BridgeRepository(this.db);
    const audit = new AuditRepository(this.db);
    const persona = await personas.findById(input.personaId);
    if (!persona) throw new PersonaNotFoundError(input.personaId);
    if (persona.kind === "ephemeral_subagent") throw new EphemeralTelegramForbiddenError();

    const secrets = new EnvSecretProvider();
    const token = await secrets.resolve(input.tokenSecretRef);
    const tokenFingerprint = fingerprintToken(token);
    const dup = await bridges.findByFingerprint(tokenFingerprint);
    if (dup) throw new DuplicateTokenFingerprintError();

    const client = new HttpTelegramClient(token);
    const me = await client.getMe();
    const webhook = await client.getWebhookInfo();
    if (webhook.url) throw new WebhookConfiguredError(webhook.url);

    const bridge = await bridges.create({
      id: newBridgeId(),
      personaId: persona.id,
      status: "provisioning",
      transport: "long_polling",
      tokenSecretRef: input.tokenSecretRef,
      tokenFingerprint,
      allowedUserIds: input.allowedUserIds,
      allowedChatIds: input.allowedChatIds,
      allowGroupChats: input.allowGroupChats ?? false,
      allowedUpdateTypes: input.allowGroupChats
        ? ["message", "callback_query", "channel_post"]
        : ["message", "callback_query"],
      outboundPolicy: input.outboundPolicy,
    });

    await bridges.updateBotInfo(bridge.id, me.id, me.username);
    await bridges.updateStatus(bridge.id, "starting");
    await audit.record({
      personaId: persona.id,
      bridgeId: bridge.id,
      eventType: "bridge.enabled",
      actor: "control-plane",
      payload: { tokenFingerprint, botUserId: me.id },
    });

    return bridges.findById(bridge.id);
  }

  async disableTelegramBridge(bridgeId: string, reason: string): Promise<void> {
    const bridges = new BridgeRepository(this.db);
    const audit = new AuditRepository(this.db);
    const bridge = await bridges.findById(bridgeId);
    if (!bridge) return;
    await bridges.updateStatus(bridgeId, "stopping");
    await audit.record({
      bridgeId,
      personaId: bridge.personaId,
      eventType: "bridge.disabled",
      actor: "control-plane",
      payload: { reason },
    });
    await bridges.updateStatus(bridgeId, "disabled");
  }
}

export class LifecycleService {
  constructor(private readonly db: Db) {}

  async startPersona(personaId: string): Promise<void> {
    const personas = new PersonaRepository(this.db);
    const persona = await personas.findById(personaId);
    if (!persona) throw new PersonaNotFoundError(personaId);
    await personas.updateStatus(personaId, "starting");
    await personas.updateStatus(personaId, "running");
  }

  async stopPersona(personaId: string, reason: string): Promise<void> {
    const personas = new PersonaRepository(this.db);
    const persona = await personas.findById(personaId);
    if (!persona) throw new PersonaNotFoundError(personaId);
    await personas.updateStatus(personaId, "stopping");
    await new AuditRepository(this.db).record({
      personaId,
      eventType: "persona.stopped",
      actor: "control-plane",
      payload: { reason },
    });
    await personas.updateStatus(personaId, "stopped");
  }
}

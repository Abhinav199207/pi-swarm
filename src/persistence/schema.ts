import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const personas = pgTable("personas", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  role: text("role").notNull(),
  systemPromptRef: text("system_prompt_ref").notNull(),
  memoryNamespace: text("memory_namespace").notNull().unique(),
  workspaceRef: text("workspace_ref").notNull(),
  toolProfile: text("tool_profile").notNull(),
  modelProfile: text("model_profile").notNull(),
  inboxTopic: text("inbox_topic").notNull().unique(),
  outboxTopic: text("outbox_topic").notNull().unique(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const telegramBridges = pgTable("telegram_bridges", {
  id: uuid("id").primaryKey(),
  personaId: uuid("persona_id")
    .notNull()
    .unique()
    .references(() => personas.id),
  status: text("status").notNull(),
  transport: text("transport").notNull(),
  tokenSecretRef: text("token_secret_ref").notNull(),
  tokenFingerprint: text("token_fingerprint").notNull().unique(),
  botUserId: text("bot_user_id"),
  botUsername: text("bot_username"),
  allowedUserIds: jsonb("allowed_user_ids").$type<string[]>().notNull(),
  allowedChatIds: jsonb("allowed_chat_ids").$type<string[]>().notNull(),
  allowGroupChats: boolean("allow_group_chats").notNull().default(false),
  allowedUpdateTypes: jsonb("allowed_update_types").$type<string[]>().notNull(),
  outboundPolicy: text("outbound_policy").notNull(),
  lastCommittedUpdateId: bigint("last_committed_update_id", { mode: "number" }),
  leaseEpoch: bigint("lease_epoch", { mode: "number" }).notNull().default(0),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const bridgeLeases = pgTable("bridge_leases", {
  bridgeId: uuid("bridge_id")
    .primaryKey()
    .references(() => telegramBridges.id),
  holderId: text("holder_id").notNull(),
  epoch: bigint("epoch", { mode: "number" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey(),
    traceId: uuid("trace_id").notNull(),
    parentMessageId: uuid("parent_message_id"),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    kind: text("kind").notNull(),
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [unique("agent_messages_to_idempotency").on(table.toAddress, table.idempotencyKey)],
);

export const telegramUpdateReceipts = pgTable(
  "telegram_update_receipts",
  {
    bridgeId: uuid("bridge_id")
      .notNull()
      .references(() => telegramBridges.id),
    updateId: bigint("update_id", { mode: "number" }).notNull(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => agentMessages.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.bridgeId, table.updateId] })],
);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey(),
  traceId: uuid("trace_id"),
  personaId: uuid("persona_id").references(() => personas.id),
  bridgeId: uuid("bridge_id").references(() => telegramBridges.id),
  eventType: text("event_type").notNull(),
  actor: text("actor").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const outboundDeliveryReceipts = pgTable("outbound_delivery_receipts", {
  id: uuid("id").primaryKey(),
  messageId: uuid("message_id")
    .notNull()
    .unique()
    .references(() => agentMessages.id),
  bridgeId: uuid("bridge_id")
    .notNull()
    .references(() => telegramBridges.id),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
  status: text("status").notNull(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const memoryScopeGrants = pgTable(
  "memory_scope_grants",
  {
    id: uuid("id").primaryKey(),
    granteeType: text("grantee_type").notNull(),
    granteeId: uuid("grantee_id").notNull(),
    scopePattern: text("scope_pattern").notNull(),
    canRead: boolean("can_read").notNull().default(true),
    canProposeWrite: boolean("can_propose_write").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [unique("memory_scope_grants_unique").on(table.granteeType, table.granteeId, table.scopePattern)],
);

export const memoryCandidates = pgTable("memory_candidates", {
  id: uuid("id").primaryKey(),
  traceId: uuid("trace_id"),
  sourcePersonaId: uuid("source_persona_id").references(() => personas.id),
  sourceRunId: uuid("source_run_id"),
  scope: text("scope").notNull(),
  kind: text("kind").notNull(),
  sensitivity: text("sensitivity").notNull(),
  statement: text("statement").notNull(),
  rationale: text("rationale"),
  provenance: jsonb("provenance").$type<Array<Record<string, unknown>>>().notNull(),
  confidence: doublePrecision("confidence").notNull(),
  disposition: text("disposition").notNull(),
  remnicMemoryId: text("remnic_memory_id").unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
});

export const memoryRecallAudit = pgTable("memory_recall_audit", {
  id: uuid("id").primaryKey(),
  requestId: uuid("request_id").notNull(),
  personaId: uuid("persona_id")
    .notNull()
    .references(() => personas.id),
  runId: uuid("run_id"),
  queryHash: text("query_hash").notNull(),
  allowedScopes: jsonb("allowed_scopes").$type<string[]>().notNull(),
  retrievedMemoryIds: jsonb("retrieved_memory_ids").$type<string[]>().notNull(),
  renderedCharCount: integer("rendered_char_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

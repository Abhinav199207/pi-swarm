import { z } from "zod";

export const PersonaKindSchema = z.enum(["concierge", "persistent_persona", "ephemeral_subagent"]);
export const PersonaStatusSchema = z.enum([
  "created",
  "starting",
  "running",
  "stopping",
  "stopped",
  "failed",
  "archived",
]);
export const BridgeStatusSchema = z.enum([
  "disabled",
  "provisioning",
  "starting",
  "active",
  "degraded",
  "stopping",
  "stopped",
  "failed",
]);
export const TransportSchema = z.enum(["long_polling"]);

export const PersonaSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9-]{3,64}$/),
  displayName: z.string().min(1).max(100),
  kind: PersonaKindSchema,
  status: PersonaStatusSchema,
  role: z.string().min(1).max(500),
  systemPromptRef: z.string(),
  memoryNamespace: z.string(),
  workspaceRef: z.string(),
  toolProfile: z.string(),
  modelProfile: z.string(),
  inboxTopic: z.string(),
  outboxTopic: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive(),
});

export const TelegramBridgeSchema = z.object({
  id: z.string().uuid(),
  personaId: z.string().uuid(),
  status: BridgeStatusSchema,
  transport: TransportSchema,
  tokenSecretRef: z.string().min(1),
  tokenFingerprint: z.string().length(64),
  botUserId: z.string().nullable(),
  botUsername: z.string().nullable(),
  allowedUserIds: z.array(z.string()).min(1),
  allowedChatIds: z.array(z.string()).min(1),
  allowGroupChats: z.boolean().default(false),
  allowedUpdateTypes: z.array(z.enum(["message", "callback_query", "channel_post"])),
  outboundPolicy: z.enum(["disabled", "replies_only", "allowlisted_only"]),
  lastCommittedUpdateId: z.number().int().nullable(),
  leaseEpoch: z.number().int().nonnegative(),
  lastHeartbeatAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PersonaKind = z.infer<typeof PersonaKindSchema>;
export type PersonaStatus = z.infer<typeof PersonaStatusSchema>;
export type BridgeStatus = z.infer<typeof BridgeStatusSchema>;
export type Persona = z.infer<typeof PersonaSchema>;
export type TelegramBridge = z.infer<typeof TelegramBridgeSchema>;

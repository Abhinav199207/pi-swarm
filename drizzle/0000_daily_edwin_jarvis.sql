CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trace_id" uuid NOT NULL,
	"parent_message_id" uuid,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"kind" text NOT NULL,
	"body" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "agent_messages_to_idempotency" UNIQUE("to_address","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trace_id" uuid,
	"persona_id" uuid,
	"bridge_id" uuid,
	"event_type" text NOT NULL,
	"actor" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridge_leases" (
	"bridge_id" uuid PRIMARY KEY NOT NULL,
	"holder_id" text NOT NULL,
	"epoch" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_delivery_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"bridge_id" uuid NOT NULL,
	"telegram_message_id" bigint,
	"status" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "outbound_delivery_receipts_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"role" text NOT NULL,
	"system_prompt_ref" text NOT NULL,
	"memory_namespace" text NOT NULL,
	"workspace_ref" text NOT NULL,
	"tool_profile" text NOT NULL,
	"model_profile" text NOT NULL,
	"inbox_topic" text NOT NULL,
	"outbox_topic" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personas_slug_unique" UNIQUE("slug"),
	CONSTRAINT "personas_memory_namespace_unique" UNIQUE("memory_namespace"),
	CONSTRAINT "personas_inbox_topic_unique" UNIQUE("inbox_topic"),
	CONSTRAINT "personas_outbox_topic_unique" UNIQUE("outbox_topic")
);
--> statement-breakpoint
CREATE TABLE "telegram_bridges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"persona_id" uuid NOT NULL,
	"status" text NOT NULL,
	"transport" text NOT NULL,
	"token_secret_ref" text NOT NULL,
	"token_fingerprint" text NOT NULL,
	"bot_user_id" text,
	"bot_username" text,
	"allowed_user_ids" jsonb NOT NULL,
	"allowed_chat_ids" jsonb NOT NULL,
	"allow_group_chats" boolean DEFAULT false NOT NULL,
	"allowed_update_types" jsonb NOT NULL,
	"outbound_policy" text NOT NULL,
	"last_committed_update_id" bigint,
	"lease_epoch" bigint DEFAULT 0 NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "telegram_bridges_persona_id_unique" UNIQUE("persona_id"),
	CONSTRAINT "telegram_bridges_token_fingerprint_unique" UNIQUE("token_fingerprint")
);
--> statement-breakpoint
CREATE TABLE "telegram_update_receipts" (
	"bridge_id" uuid NOT NULL,
	"update_id" bigint NOT NULL,
	"message_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "telegram_update_receipts_bridge_id_update_id_pk" PRIMARY KEY("bridge_id","update_id")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_bridge_id_telegram_bridges_id_fk" FOREIGN KEY ("bridge_id") REFERENCES "public"."telegram_bridges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_leases" ADD CONSTRAINT "bridge_leases_bridge_id_telegram_bridges_id_fk" FOREIGN KEY ("bridge_id") REFERENCES "public"."telegram_bridges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_delivery_receipts" ADD CONSTRAINT "outbound_delivery_receipts_message_id_agent_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."agent_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_delivery_receipts" ADD CONSTRAINT "outbound_delivery_receipts_bridge_id_telegram_bridges_id_fk" FOREIGN KEY ("bridge_id") REFERENCES "public"."telegram_bridges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bridges" ADD CONSTRAINT "telegram_bridges_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_update_receipts" ADD CONSTRAINT "telegram_update_receipts_bridge_id_telegram_bridges_id_fk" FOREIGN KEY ("bridge_id") REFERENCES "public"."telegram_bridges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_update_receipts" ADD CONSTRAINT "telegram_update_receipts_message_id_agent_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."agent_messages"("id") ON DELETE no action ON UPDATE no action;
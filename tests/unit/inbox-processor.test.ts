import { describe, expect, it } from "vitest";
import { processInboxCommands, processInboxMessage } from "../../src/runtime/inbox-processor.ts";
import type { AgentMessage } from "../../src/domain/messages.ts";
import type { Persona } from "../../src/domain/persona.ts";

const persona: Persona = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "atlas-infra",
  displayName: "Atlas Infra",
  kind: "persistent_persona",
  status: "running",
  role: "Infra specialist",
  systemPromptRef: "prompts/atlas-infra.md",
  memoryNamespace: "persona/atlas-infra",
  workspaceRef: "workspaces/atlas-infra",
  toolProfile: "default",
  modelProfile: "primary",
  inboxTopic: "persona.atlas-infra.inbox",
  outboxTopic: "persona.atlas-infra.outbox",
  version: 1,
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
};

function inboundMessage(text: string): AgentMessage {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    traceId: "00000000-0000-4000-8000-000000000011",
    parentMessageId: null,
    from: "telegram:00000000-0000-4000-8000-000000000002",
    to: "persona:atlas-infra",
    kind: "telegram.inbound",
    body: {
      bridgeId: "00000000-0000-4000-8000-000000000002",
      telegramUpdateId: 1,
      telegramMessageId: 99,
      userId: "8958101948",
      chatId: "8958101948",
      chatType: "private",
      text,
      command: null,
      replyToMessageId: null,
      receivedAt: "2026-08-15T00:00:00.000Z",
      rawArtifactRef: null,
    },
    idempotencyKey: "telegram:test:1",
    createdAt: "2026-08-15T00:00:00.000Z",
    expiresAt: null,
  };
}

describe("inbox processor", () => {
  it("creates telegram.send reply for inbound messages in fake worker mode", () => {
    const events = processInboxMessage(persona, inboundMessage("hello"));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("telegram.send");
    if (events[0]?.type === "telegram.send") {
      expect(events[0].body.text).toContain("[atlas-infra]");
      expect(events[0].body.chatId).toBe("8958101948");
      expect(events[0].body.reason).toBe("reply");
    }
  });

  it("returns no events for normal text when using Pi RPC commands path", () => {
    const events = processInboxCommands(persona, inboundMessage("hello"));
    expect(events).toHaveLength(0);
  });

  it("handles /help as a direct command reply", () => {
    const events = processInboxCommands(persona, inboundMessage("/help"));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("telegram.send");
    if (events[0]?.type === "telegram.send") {
      expect(String(events[0].body.text)).toContain("/status");
    }
  });
});

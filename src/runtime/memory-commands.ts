import type { Persona } from "../domain/persona.js";
import type { AgentMessage } from "../domain/messages.js";
import { TelegramInboundBodySchema } from "../domain/messages.js";
import type { PersonaWorkerEvent } from "./pi-rpc-worker.js";
import { MemoryRepository } from "../persistence/repositories/memory-repository.js";

export async function processMemoryCommands(
  persona: Persona,
  message: AgentMessage,
  repo: MemoryRepository,
  review?: (candidateId: string, approve: boolean) => Promise<void>,
): Promise<PersonaWorkerEvent[]> {
  if (message.kind !== "telegram.inbound") return [];

  const body = TelegramInboundBodySchema.parse(message.body);
  const text = body.text?.trim() ?? "";
  if (!text.startsWith("/memory")) return [];

  const parts = text.split(/\s+/);
  const sub = parts[1] ?? "help";

  if (sub === "pending") {
    const pending = await repo.listCandidatesByDisposition("pending_review", 5);
    const lines = pending.length
      ? pending.map((c) => `${c.id.slice(0, 8)}… ${c.scope} (${c.kind})`)
      : ["No pending memory candidates."];
    return [telegramReply(persona, body, ["Memory review queue:", ...lines].join("\n"))];
  }

  if ((sub === "approve" || sub === "reject") && parts[2] && review) {
    const candidateId = parts[2];
    await review(candidateId, sub === "approve");
    return [telegramReply(persona, body, `Memory candidate ${sub}d: ${candidateId.slice(0, 8)}…`)];
  }

  return [
    telegramReply(
      persona,
      body,
      "Memory commands: /memory pending, /memory approve <id>, /memory reject <id>",
    ),
  ];
}

function telegramReply(
  persona: Persona,
  body: ReturnType<typeof TelegramInboundBodySchema.parse>,
  text: string,
): PersonaWorkerEvent {
  return {
    type: "telegram.send",
    body: {
      bridgeId: body.bridgeId,
      chatId: body.chatId,
      text: text.slice(0, 4096),
      replyToMessageId: body.telegramMessageId,
      parseMode: "plain",
      reason: "reply",
    },
  };
}

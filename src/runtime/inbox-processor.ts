import type { AgentMessage } from "../domain/messages.js";
import { TelegramInboundBodySchema } from "../domain/messages.js";
import type { Persona } from "../domain/persona.js";
import type { PersonaWorkerEvent } from "./pi-rpc-worker.js";

const CONTROL_COMMAND_PREFIXES = ["/help", "/status", "/cancel", "/approve", "/deny", "/memory"];

/** Deterministic replies for slash commands only. Normal text returns [] for Pi RPC. */
export function processInboxCommands(persona: Persona, message: AgentMessage): PersonaWorkerEvent[] {
  if (message.kind !== "telegram.inbound") return [];

  const body = TelegramInboundBodySchema.parse(message.body);
  const text = body.text?.trim() ?? "";
  if (!text.startsWith("/")) return [];

  if (text.startsWith("/status")) {
    return [telegramReply(persona, body, `${persona.slug} is running. Bridge active.`)];
  }
  if (text.startsWith("/help")) {
    return [
      telegramReply(
        persona,
        body,
        "Commands: /status, /help, /memory pending. Send any other message and the persona LLM will reply.",
      ),
    ];
  }
  if (text.startsWith("/memory")) {
    return [];
  }

  return [telegramReply(persona, body, `[${persona.slug}] Unknown command. Try /status or /help.`)];
}

export function isControlCommand(text: string): boolean {
  return CONTROL_COMMAND_PREFIXES.some((cmd) => text.startsWith(cmd));
}

/** Echo stub used when USE_FAKE_WORKER=true. */
export function processInboxMessage(persona: Persona, message: AgentMessage): PersonaWorkerEvent[] {
  const commandEvents = processInboxCommands(persona, message);
  if (commandEvents.length > 0) return commandEvents;

  if (message.kind === "telegram.inbound") {
    const body = TelegramInboundBodySchema.parse(message.body);
    const text = body.text?.trim() ?? "";
    return [telegramReply(persona, body, `[${persona.slug}] ${text || "(empty message)"}`)];
  }

  if (message.kind === "agent.task") {
    const task = typeof message.body.task === "string" ? message.body.task : "task";
    return [{ type: "status", message: `${persona.slug} accepted task: ${task.slice(0, 200)}` }];
  }

  return [{ type: "status", message: `${persona.slug} ignored ${message.kind}` }];
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

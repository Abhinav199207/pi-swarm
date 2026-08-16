import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { AgentMessage } from "../domain/messages.js";
import { TelegramInboundBodySchema } from "../domain/messages.js";
import type { Persona } from "../domain/persona.js";
import { processInboxCommands } from "./inbox-processor.js";
import { PiRpcClient } from "./pi-rpc-client.js";
import type { MemoryRecallService } from "../control-plane/memory-recall-service.js";
import type { MemoryCandidateService } from "../control-plane/memory-curation-service.js";
import { CONCIERGE_MEMORY_EXTRA, MEMORY_RULES_BLOCK } from "../memory/memory-runtime.js";

export type PersonaWorkerEvent =
  | { type: "status"; message: string }
  | { type: "telegram.send"; body: Record<string, unknown> }
  | { type: "agent.result"; body: Record<string, unknown> };

export interface PersonaWorker {
  start(input: {
    persona: Persona;
    signal: AbortSignal;
    onEvent(event: PersonaWorkerEvent): Promise<void>;
  }): Promise<void>;
  stop(): Promise<void>;
  isHealthy(): Promise<boolean>;
  handleInboxMessage?(persona: Persona, message: AgentMessage): Promise<PersonaWorkerEvent[]>;
}

export class FakePersonaWorker implements PersonaWorker {
  running = false;

  async start(input: { persona: Persona; signal: AbortSignal; onEvent: (event: PersonaWorkerEvent) => Promise<void> }) {
    this.running = true;
    await input.onEvent({ type: "status", message: `${input.persona.slug} worker started (fake)` });
    await new Promise<void>((resolve) => {
      input.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    this.running = false;
  }

  async stop() {
    this.running = false;
  }

  async isHealthy() {
    return this.running;
  }
}

export class PiRpcWorker implements PersonaWorker {
  private client: PiRpcClient | null = null;
  private running = false;
  private processing = Promise.resolve();
  private workspaceRoot = process.cwd();

  constructor(
    private readonly config: AppConfig,
    private readonly memory?: {
      recall: MemoryRecallService;
      candidates: MemoryCandidateService;
    },
  ) {}

  async start(input: {
    persona: Persona;
    signal: AbortSignal;
    onEvent: (event: PersonaWorkerEvent) => Promise<void>;
  }) {
    await this.ensureWorkspace(input.persona);
    this.client = new PiRpcClient({
      command: this.config.piCommand,
      args: this.buildPiArgs(input.persona),
      cwd: this.resolveWorkspace(input.persona),
      env: {
        SWARM_PERSONA_SLUG: input.persona.slug,
        SWARM_AGENT_NAME: input.persona.slug,
        SWARM_AGENT_KIND: input.persona.kind === "concierge" ? "coordinator" : "persistent",
      },
      idleTimeoutMs: this.config.piRpcTimeoutMs,
    });
    await this.client.start();
    this.running = true;
    await input.onEvent({ type: "status", message: `pi rpc started for ${input.persona.slug}` });
    input.signal.addEventListener("abort", () => void this.stop(), { once: true });
  }

  async stop() {
    this.running = false;
    await this.client?.stop();
    this.client = null;
  }

  async isHealthy() {
    return this.running && (this.client?.isRunning() ?? false);
  }

  async handleInboxMessage(persona: Persona, message: AgentMessage): Promise<PersonaWorkerEvent[]> {
    const result = await new Promise<PersonaWorkerEvent[]>((resolve, reject) => {
      this.processing = this.processing
        .then(async () => resolve(await this.processMessage(persona, message)))
        .catch(reject);
    });
    return result;
  }

  private async processMessage(persona: Persona, message: AgentMessage): Promise<PersonaWorkerEvent[]> {
    const commandEvents = processInboxCommands(persona, message);
    if (commandEvents.length > 0) return commandEvents;

    if (message.kind === "telegram.inbound") {
      return this.handleTelegramInbound(persona, message);
    }

    if (message.kind === "agent.task") {
      const task = typeof message.body.task === "string" ? message.body.task : JSON.stringify(message.body);
      let memoryContext = "";
      if (this.memory?.recall.shouldRecall(message)) {
        const recall = await this.memory.recall.recallForMessage({ persona, message });
        memoryContext = recall.renderedContext;
      }
      const reply = await this.runPrompt(buildTaskPrompt(persona, task, memoryContext));
      return [{ type: "agent.result", body: { task, reply } }];
    }

    return [{ type: "status", message: `${persona.slug} ignored ${message.kind}` }];
  }

  private async handleTelegramInbound(persona: Persona, message: AgentMessage): Promise<PersonaWorkerEvent[]> {
    const body = TelegramInboundBodySchema.parse(message.body);
    const text = body.text?.trim() ?? "";
    if (!text) {
      return [
        {
          type: "telegram.send",
          body: {
            bridgeId: body.bridgeId,
            chatId: body.chatId,
            text: "(empty message)",
            replyToMessageId: body.telegramMessageId,
            parseMode: "plain",
            reason: "reply",
          },
        },
      ];
    }

    try {
      let memoryContext = "";
      if (this.memory?.recall.shouldRecall(message)) {
        const recall = await this.memory.recall.recallForMessage({ persona, message });
        memoryContext = recall.renderedContext;
      }

      if (this.config.memoryExtractionEnabled && this.memory?.candidates) {
        const rememberMatch = text.match(/^(?:please\s+)?remember\s+/i);
        if (rememberMatch) {
          await this.memory.candidates.enqueueFromUserMessage({ persona, message, text });
        }
      }

      const reply = await this.runPrompt(buildTelegramPrompt(persona, text, memoryContext));
      return [
        {
          type: "telegram.send",
          body: {
            bridgeId: body.bridgeId,
            chatId: body.chatId,
            text: reply.slice(0, this.config.maxTelegramMessageLength),
            replyToMessageId: body.telegramMessageId,
            parseMode: "plain",
            reason: "reply",
          },
        },
      ];
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      return [
        {
          type: "telegram.send",
          body: {
            bridgeId: body.bridgeId,
            chatId: body.chatId,
            text: `[${persona.slug}] Sorry, I hit an error talking to the model: ${errorText.slice(0, 500)}`,
            replyToMessageId: body.telegramMessageId,
            parseMode: "plain",
            reason: "reply",
          },
        },
      ];
    }
  }

  private async runPrompt(prompt: string): Promise<string> {
    if (!this.client?.isRunning()) {
      throw new Error("Pi RPC worker is not running");
    }
    return this.client.promptAndGetReply(prompt, this.config.piRpcTimeoutMs);
  }

  private buildPiArgs(persona: Persona): string[] {
    const args = ["--mode", "rpc", "--name", persona.slug];
    if (this.config.piProvider) args.push("--provider", this.config.piProvider);
    if (this.config.piModel) args.push("--model", this.config.piModel);
    const sessionDir = path.join(this.config.personaRuntimeRoot, persona.slug, "sessions");
    args.push("--session-dir", sessionDir);
    if (this.config.piCliPath) {
      return [this.config.piCliPath, ...args];
    }
    return args;
  }

  private resolveWorkspace(persona: Persona): string {
    return path.resolve(this.workspaceRoot, persona.workspaceRef);
  }

  private async ensureWorkspace(persona: Persona): Promise<void> {
    const workspace = this.resolveWorkspace(persona);
    await mkdir(workspace, { recursive: true });
    await mkdir(path.join(this.config.personaRuntimeRoot, persona.slug, "sessions"), { recursive: true });

    const promptPath = path.resolve(this.workspaceRoot, persona.systemPromptRef);
    const agentsPath = path.join(workspace, "AGENTS.md");
    try {
      const prompt = await readFile(promptPath, "utf8");
      const memoryBlock = [
        prompt,
        "",
        MEMORY_RULES_BLOCK,
        persona.kind === "concierge" ? CONCIERGE_MEMORY_EXTRA : "",
      ]
        .filter(Boolean)
        .join("\n");
      await writeFile(agentsPath, memoryBlock, "utf8");
    } catch {
      await writeFile(
        agentsPath,
        `# ${persona.displayName}\n\n${persona.role}\n`,
        "utf8",
      );
    }
  }
}

function buildTelegramPrompt(persona: Persona, text: string, memoryContext: string): string {
  return [
    `You are ${persona.displayName} (${persona.slug}).`,
    persona.role,
    "",
    memoryContext ? `${memoryContext}\n` : "",
    "The user sent this message via Telegram.",
    "Reply directly to the user in plain text suitable for Telegram.",
    "Keep the response concise unless they ask for detail.",
    "",
    `User message: ${text}`,
  ].join("\n");
}

function buildTaskPrompt(persona: Persona, task: string, memoryContext: string): string {
  return [
    `You are ${persona.displayName} (${persona.slug}).`,
    persona.role,
    "",
    memoryContext ? `${memoryContext}\n` : "",
    "Complete this internal task and return the result:",
    task,
  ].join("\n");
}

export function newPersonaWorker(
  config: AppConfig,
  memory?: { recall: MemoryRecallService; candidates: MemoryCandidateService },
): PersonaWorker {
  if (config.useFakeWorker) return new FakePersonaWorker();
  return new PiRpcWorker(config, memory);
}

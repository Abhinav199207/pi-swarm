import type { AgentMessage } from "../domain/messages.js";
import type { Persona } from "../domain/persona.js";
import type { MessageBus } from "./message-bus.js";

export class InboxWorker {
  constructor(
    private readonly bus: MessageBus,
    private readonly persona: Persona,
    private readonly onMessage: (message: AgentMessage) => Promise<void>,
    private readonly pollIntervalMs = 500,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    const address = `persona:${this.persona.slug}`;
    while (!signal.aborted) {
      const messages = await this.bus.claim(address, 10);
      for (const message of messages) {
        await this.onMessage(message);
        await this.bus.markProcessed(message.id);
      }
      if (messages.length === 0) {
        await sleep(this.pollIntervalMs);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

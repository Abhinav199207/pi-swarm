import type { AgentMessage } from "../domain/messages.js";
import type { MessageBus } from "./message-bus.js";
import { MemoryCurationService } from "../control-plane/memory-curation-service.js";

export class MemoryCurationWorker {
  constructor(
    private readonly bus: MessageBus,
    private readonly curation: MemoryCurationService,
    private readonly pollIntervalMs = 2000,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const messages = await this.bus.claim("service:memory-curator", 10);
      for (const message of messages) {
        try {
          if (message.kind === "memory.candidate") {
            await this.curation.processCandidateMessage(message);
          }
          await this.bus.markProcessed(message.id);
        } catch {
          // Leave unprocessed for retry
        }
      }
      await sleep(this.pollIntervalMs, signal);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

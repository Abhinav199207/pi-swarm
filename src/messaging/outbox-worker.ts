import type { TelegramBridge } from "../domain/persona.js";
import { TelegramSender } from "../telegram/telegram-sender.js";
import type { MessageBus } from "./message-bus.js";
import { getLogger } from "../observability/logger.js";

export class OutboxWorker {
  constructor(
    private readonly bus: MessageBus,
    private readonly bridge: TelegramBridge,
    private readonly sender: TelegramSender,
    private readonly pollIntervalMs = 500,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    const address = `bridge:${this.bridge.id}`;
    const log = getLogger();
    while (!signal.aborted) {
      const messages = await this.bus.claim(address, 10);
      for (const message of messages) {
        if (message.kind === "telegram.send") {
          try {
            await this.sender.processOutboundMessage(message.id, message.body);
          } catch (err) {
            log.error({ err, messageId: message.id, bridgeId: this.bridge.id }, "outbound send failed");
          }
        }
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

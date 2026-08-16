import { describe, expect, it, vi } from "vitest";
import { FakeTelegramClient } from "../../src/telegram/http-telegram-client.ts";
import { startTelegramTyping } from "../../src/telegram/telegram-typing.ts";

describe("telegram typing", () => {
  it("sends typing immediately and on refresh interval", async () => {
    vi.useFakeTimers();
    const client = new FakeTelegramClient();

    const handle = startTelegramTyping(client, "12345", 4000);
    expect(client.chatActions).toHaveLength(1);
    expect(client.chatActions[0]).toEqual({ chatId: "12345", action: "typing" });

    vi.advanceTimersByTime(4000);
    expect(client.chatActions).toHaveLength(2);

    handle.stop();
    vi.advanceTimersByTime(8000);
    expect(client.chatActions).toHaveLength(2);

    vi.useRealTimers();
  });

  it("does not throw when sendChatAction fails", async () => {
    const client = new FakeTelegramClient();
    client.sendChatAction = vi.fn().mockRejectedValue(new Error("network"));

    expect(() => startTelegramTyping(client, "999", 4000)).not.toThrow();
    await Promise.resolve();
  });
});

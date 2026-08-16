import type { TelegramClient } from "./telegram-client.js";

export type TelegramTypingHandle = {
  stop(): void;
};

/** Send typing immediately and refresh until stop() — Telegram clears typing after ~5s. */
export function startTelegramTyping(
  client: TelegramClient,
  chatId: string,
  refreshMs = 4000,
): TelegramTypingHandle {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const pulse = () => {
    void client.sendChatAction({ chatId, action: "typing" }).catch(() => {
      // Typing must never block replies.
    });
  };

  pulse();
  timer = setInterval(() => {
    if (!stopped) pulse();
  }, refreshMs);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}

import { describe, expect, it } from "vitest";
import { fingerprintToken, redactToken } from "../../src/secrets/env-secret-provider.ts";
import { authorizeTelegramUser } from "../../src/domain/policies.ts";
import { normalizeTelegramUpdate } from "../../src/telegram/telegram-normalizer.ts";

describe("token fingerprint", () => {
  it("hashes token without exposing raw value in output", () => {
    const fp = fingerprintToken("123456789:ABCsecret");
    expect(fp).toHaveLength(64);
    expect(fp).not.toContain("ABCsecret");
    expect(redactToken("123456789:ABCsecret")).not.toContain("ABCsecret");
  });
});

describe("authorization", () => {
  it("denies unknown users and group chats when disabled", () => {
    const base = {
      allowedUserIds: ["111"],
      allowedChatIds: ["222"],
      allowGroupChats: false,
      userId: "999",
      chatId: "222",
      chatType: "private" as const,
    };
    expect(authorizeTelegramUser(base)).toBe(false);
    expect(
      authorizeTelegramUser({
        ...base,
        userId: "111",
        chatType: "group",
      }),
    ).toBe(false);
    expect(
      authorizeTelegramUser({
        ...base,
        userId: "111",
      }),
    ).toBe(true);
  });
});

describe("normalizer", () => {
  it("normalizes authorized private messages", () => {
    const body = normalizeTelegramUpdate("00000000-0000-4000-8000-000000000001", {
      update_id: 42,
      message: {
        message_id: 7,
        text: "hello",
        chat: { id: 222, type: "private" },
        from: { id: 111, username: "alice" },
      },
    });
    expect(body?.userId).toBe("111");
    expect(body?.chatId).toBe("222");
    expect(body?.text).toBe("hello");
  });
});

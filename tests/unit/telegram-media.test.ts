import { describe, expect, it } from "vitest";
import { authorizeTelegramUser } from "../../src/domain/policies.ts";
import {
  buildTelegramSendBodies,
  parseReplyForOutbound,
} from "../../src/telegram/telegram-media-parse.ts";
import { mediaKindForPath } from "../../src/telegram/telegram-multipart.ts";
import { normalizeTelegramUpdate } from "../../src/telegram/telegram-normalizer.ts";

describe("authorization", () => {
  const base = {
    allowedUserIds: ["111"],
    allowedChatIds: ["-100222"],
    allowGroupChats: true,
    userId: "111",
    chatId: "-100222",
  };

  it("allows private chats when user and chat are allowlisted", () => {
    expect(
      authorizeTelegramUser({
        ...base,
        chatId: "999",
        chatType: "private",
      }),
    ).toBe(false);
    expect(
      authorizeTelegramUser({
        ...base,
        allowedChatIds: ["999"],
        chatId: "999",
        chatType: "private",
      }),
    ).toBe(true);
  });

  it("allows channels and groups when allowGroupChats is enabled", () => {
    expect(
      authorizeTelegramUser({
        ...base,
        chatType: "channel",
      }),
    ).toBe(true);
    expect(
      authorizeTelegramUser({
        ...base,
        chatType: "supergroup",
      }),
    ).toBe(true);
    expect(
      authorizeTelegramUser({
        ...base,
        allowGroupChats: false,
        chatType: "channel",
      }),
    ).toBe(false);
  });
});

describe("media parse", () => {
  it("detects media kinds by extension", () => {
    expect(mediaKindForPath("/tmp/clip.mp4")).toBe("video");
    expect(mediaKindForPath("/tmp/voice.ogg")).toBe("voice");
    expect(mediaKindForPath("/tmp/track.mp3")).toBe("audio");
  });

  it("parses MEDIA markers into video delivery", () => {
    const parts = parseReplyForOutbound("Here is the render.\nMEDIA:/data/out/shot.mp4", {
      voiceTts: false,
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]?.delivery).toBe("video");
    expect(parts[0]?.text).toContain("Here is the render");
    expect(parts[0]?.mediaPath).toMatch(/shot\.mp4$/);
  });

  it("builds telegram send bodies with captions on first media item", () => {
    const bodies = buildTelegramSendBodies(
      {
        bridgeId: "00000000-0000-4000-8000-000000000001",
        chatId: "-100222",
        replyToMessageId: 42,
        parseMode: "plain",
        reason: "reply",
      },
      [{ delivery: "video", text: "caption", mediaPath: "/tmp/a.mp4" }],
    );
    expect(bodies[0]?.delivery).toBe("video");
    expect(bodies[0]?.text).toBe("caption");
    expect(bodies[0]?.mediaPath).toBe("/tmp/a.mp4");
  });
});

describe("normalizer", () => {
  it("normalizes channel_post updates", () => {
    const body = normalizeTelegramUpdate("00000000-0000-4000-8000-000000000001", {
      update_id: 99,
      channel_post: {
        message_id: 12,
        text: "post to channel",
        chat: { id: -100222, type: "channel" },
        sender_chat: { id: -100222, type: "channel", title: "Test Channel" },
      },
    });
    expect(body?.chatType).toBe("channel");
    expect(body?.chatId).toBe("-100222");
    expect(body?.text).toBe("post to channel");
  });
});

import { describe, expect, it } from "vitest";
import { plainTextForTts } from "../../src/audio/gx10-audio.js";
import { formatVoiceTranscript, normalizeTelegramUpdate } from "../../src/telegram/telegram-normalizer.js";

describe("telegram voice normalizer", () => {
  it("detects voice messages and leaves text for transcription", () => {
    const body = normalizeTelegramUpdate("00000000-0000-4000-8000-000000000001", {
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 8958101948, type: "private" },
        from: { id: 8958101948, username: "abhinav" },
        voice: { file_id: "voice-file-1", duration: 3 },
        caption: "check this",
      },
    });
    expect(body?.inputModality).toBe("voice");
    expect(body?.voiceFileId).toBe("voice-file-1");
    expect(body?.text).toBeNull();
    expect(body?.caption).toBe("check this");
  });

  it("formats voice transcript with caption", () => {
    expect(formatVoiceTranscript("hello there", "note")).toBe("[voice] hello there\n\n[caption] note");
  });
});

describe("plainTextForTts", () => {
  it("strips markdown for speech synthesis", () => {
    expect(plainTextForTts("**Hi** _there_ `code`")).toBe("Hi there code");
  });
});

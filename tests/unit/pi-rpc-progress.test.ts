import { describe, expect, it } from "vitest";
import {
  createProgressFormatState,
  formatPiRpcProgress,
  isPriorityProgressEvent,
  progressIdempotencyKey,
} from "../../src/runtime/pi-rpc-progress.ts";

describe("pi-rpc-progress", () => {
  it("formats meaningful tool and lifecycle events", () => {
    expect(formatPiRpcProgress({ type: "agent_start" })).toBe("Working on your request…");
    expect(formatPiRpcProgress({ type: "message_update" })).toBeNull();
    expect(formatPiRpcProgress({ type: "turn_start" })).toBeNull();
    expect(formatPiRpcProgress({ type: "tool_execution_start", toolName: "read", args: { path: "src/app.ts" } })).toBe(
      "Tool: read — `src/app.ts`",
    );
    expect(
      formatPiRpcProgress({
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "git status\n" },
      }),
    ).toBe("Tool: bash — `git status`");
    expect(formatPiRpcProgress({ type: "heartbeat", elapsedSeconds: 95 })).toBe("Still working… (1m 35s)");
    const state = createProgressFormatState();
    formatPiRpcProgress(
      { type: "tool_execution_start", toolName: "bash", args: { command: "npm run build" } },
      state,
    );
    expect(formatPiRpcProgress({ type: "heartbeat", elapsedSeconds: 120 }, state)).toBe(
      "Still working — bash — `npm run build` (2m)",
    );
    expect(formatPiRpcProgress({ type: "tool_execution_end", toolName: "bash", isError: false })).toBe(
      "Tool done: bash",
    );
    expect(formatPiRpcProgress({ type: "tool_execution_start", toolName: "custom", args: { foo: "bar" } })).toBe(
      "Tool: custom — foo=`bar`",
    );
  });

  it("suppresses token streaming but surfaces thinking snippets once", () => {
    const state = createProgressFormatState();
    const event = {
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        text: "I should inspect the pi-swarm config and logs first.",
      },
    };
    expect(formatPiRpcProgress(event, state)).toBe(
      "Thinking: I should inspect the pi-swarm config and logs first.",
    );
    expect(formatPiRpcProgress(event, state)).toBeNull();
  });

  it("only emits bash updates when output line changes", () => {
    const state = createProgressFormatState();
    const event = {
      type: "tool_execution_update",
      toolCallId: "call_1",
      toolName: "bash",
      partialResult: { output: "line one\nline two\n" },
    };
    expect(formatPiRpcProgress(event, state)).toBe("Running: line two");
    expect(formatPiRpcProgress(event, state)).toBeNull();
  });

  it("marks tool lifecycle events as priority", () => {
    expect(isPriorityProgressEvent({ type: "tool_execution_start" })).toBe(true);
    expect(isPriorityProgressEvent({ type: "tool_execution_end" })).toBe(true);
    expect(isPriorityProgressEvent({ type: "heartbeat" })).toBe(false);
  });

  it("builds stable idempotency keys", () => {
    const parent = "11111111-1111-1111-1111-111111111111";
    expect(progressIdempotencyKey(parent, { type: "agent_start" })).toBe(`progress:${parent}:agent_start`);
    expect(
      progressIdempotencyKey(parent, { type: "tool_execution_start", toolCallId: "call_1" }),
    ).toBe(`progress:${parent}:tool:call_1`);
  });
});

export type PiRpcProgressEvent = Record<string, unknown>;

export type ProgressFormatState = {
  lastBashLine: Map<string, string>;
  sentThinkingKeys: Set<string>;
  lastToolLabel: string | null;
  toolCount: number;
};

export function createProgressFormatState(): ProgressFormatState {
  return {
    lastBashLine: new Map(),
    sentThinkingKeys: new Set(),
    lastToolLabel: null,
    toolCount: 0,
  };
}

export function formatPiRpcProgress(
  event: PiRpcProgressEvent,
  state: ProgressFormatState = createProgressFormatState(),
): string | null {
  const type = event.type;
  if (type === "agent_start") return "Working on your request…";
  if (type === "turn_start") return null;
  if (type === "message_update") return formatMessageUpdate(event, state);
  if (type === "tool_execution_start") return formatToolStart(event, state);
  if (type === "tool_execution_update") return formatToolUpdate(event, state);
  if (type === "tool_execution_end") return formatToolEnd(event);
  if (type === "turn_end") return formatTurnEnd(event);
  if (type === "compaction_start") return "Compacting conversation context…";
  if (type === "auto_retry_start") {
    const attempt = event.attempt;
    const max = event.maxAttempts;
    if (typeof attempt === "number" && typeof max === "number") {
      return `Model busy — retrying (${attempt}/${max})…`;
    }
    return "Model busy — retrying…";
  }
  if (type === "heartbeat") {
    const elapsedSeconds = event.elapsedSeconds;
    const elapsed =
      typeof elapsedSeconds === "number" ? formatElapsed(elapsedSeconds) : null;
    const lastAction = state.lastToolLabel;
    if (lastAction && elapsed) return `Still working — ${lastAction} (${elapsed})`;
    if (lastAction) return `Still working — ${lastAction}`;
    if (elapsed) return `Still working… (${elapsed})`;
    return "Still working…";
  }
  return null;
}

function formatMessageUpdate(event: PiRpcProgressEvent, state: ProgressFormatState): string | null {
  const delta = event.assistantMessageEvent as Record<string, unknown> | undefined;
  if (!delta) return null;

  const deltaType = String(delta.type ?? "");
  if (deltaType !== "thinking_delta" && deltaType !== "reasoning_delta") {
    return null;
  }

  const text = typeof delta.text === "string" ? delta.text.trim() : "";
  if (text.length < 24) return null;

  const snippet = truncate(text.split(/\n+/).find((line) => line.trim().length >= 12)?.trim() ?? text, 160);
  const key = `${deltaType}:${snippet.slice(0, 48)}`;
  if (state.sentThinkingKeys.has(key)) return null;
  state.sentThinkingKeys.add(key);

  return `Thinking: ${snippet}`;
}

function formatToolStart(event: PiRpcProgressEvent, state?: ProgressFormatState): string | null {
  const toolName = String(event.toolName ?? "tool");
  const args = (event.args ?? {}) as Record<string, unknown>;
  let label: string | null = null;

  if (toolName === "bash" && typeof args.command === "string") {
    const cmd = args.command.trim().split("\n")[0] ?? "";
    label = cmd ? `Tool: bash — \`${truncate(cmd, 120)}\`` : "Tool: bash";
  }
  if (!label && toolName === "read" && typeof args.path === "string") {
    label = `Tool: read — \`${truncate(args.path, 100)}\``;
  }
  if (!label && (toolName === "write" || toolName === "edit") && typeof args.path === "string") {
    label = `Tool: ${toolName} — \`${truncate(args.path, 100)}\``;
  }
  if (!label && toolName === "grep") {
    const pattern = typeof args.pattern === "string" ? args.pattern : null;
    const path = typeof args.path === "string" ? args.path : typeof args.glob === "string" ? args.glob : null;
    if (pattern && path) {
      label = `Tool: grep — \`${truncate(pattern, 60)}\` in \`${truncate(path, 60)}\``;
    } else if (pattern) {
      label = `Tool: grep — \`${truncate(pattern, 80)}\``;
    }
  }
  if (!label && toolName === "find" && typeof args.path === "string") {
    label = `Tool: find — \`${truncate(args.path, 100)}\``;
  }
  if (!label && toolName === "ls" && typeof args.path === "string") {
    label = `Tool: ls — \`${truncate(args.path, 100)}\``;
  }

  if (!label) {
    const preview = summarizeArgs(args);
    label = preview ? `Tool: ${toolName} — ${preview}` : `Tool: ${toolName}`;
  }

  if (state) {
    state.toolCount += 1;
    state.lastToolLabel = label.replace(/^Tool: /, "");
  }
  return label;
}

function formatToolUpdate(event: PiRpcProgressEvent, state: ProgressFormatState): string | null {
  const toolName = String(event.toolName ?? "tool");
  if (toolName !== "bash") return null;

  const toolCallId = String(event.toolCallId ?? "");
  const partial = event.partialResult as Record<string, unknown> | undefined;
  if (typeof partial?.output !== "string" || !partial.output.trim()) return null;

  const line = partial.output.trim().split("\n").at(-1)?.trim() ?? "";
  if (!line || line.length < 4) return null;

  const prev = state.lastBashLine.get(toolCallId);
  if (prev === line) return null;
  state.lastBashLine.set(toolCallId, line);

  return `Running: ${truncate(line, 120)}`;
}

function formatToolEnd(event: PiRpcProgressEvent): string | null {
  const toolName = String(event.toolName ?? "tool");
  if (event.isError) return `Tool done: ${toolName} (failed)`;
  return `Tool done: ${toolName}`;
}

function formatTurnEnd(event: PiRpcProgressEvent): string | null {
  const turnIndex = event.turnIndex;
  if (typeof turnIndex !== "number" || turnIndex < 1) return null;
  return `Step ${turnIndex} complete — continuing…`;
}

export function progressIdempotencyKey(parentMessageId: string, event: PiRpcProgressEvent): string {
  const type = String(event.type ?? "event");
  if (type === "tool_execution_start" && event.toolCallId) {
    return `progress:${parentMessageId}:tool:${String(event.toolCallId)}`;
  }
  if (type === "tool_execution_update" && event.toolCallId) {
    const partial = event.partialResult as Record<string, unknown> | undefined;
    const line =
      typeof partial?.output === "string" ? partial.output.trim().split("\n").at(-1)?.trim() ?? "" : "";
    return `progress:${parentMessageId}:tool-update:${String(event.toolCallId)}:${line.slice(0, 40)}`;
  }
  if (type === "tool_execution_end" && event.toolCallId) {
    return `progress:${parentMessageId}:tool-end:${String(event.toolCallId)}`;
  }
  if (type === "auto_retry_start" && event.attempt != null) {
    return `progress:${parentMessageId}:retry:${String(event.attempt)}`;
  }
  if (type === "heartbeat" && event.elapsedSeconds != null) {
    return `progress:${parentMessageId}:heartbeat:${String(event.elapsedSeconds)}`;
  }
  if (type === "turn_end" && event.turnIndex != null) {
    return `progress:${parentMessageId}:turn:${String(event.turnIndex)}`;
  }
  if (type === "message_update") {
    const delta = event.assistantMessageEvent as Record<string, unknown> | undefined;
    const text = typeof delta?.text === "string" ? delta.text.slice(0, 48) : type;
    return `progress:${parentMessageId}:thinking:${text}`;
  }
  return `progress:${parentMessageId}:${type}`;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value == null) continue;
    if (typeof value === "string") {
      parts.push(`${key}=\`${truncate(value.trim(), 60)}\``);
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}=${String(value)}`);
    }
    if (parts.length >= 3) break;
  }
  return parts.join(", ");
}

export function isPriorityProgressEvent(event: PiRpcProgressEvent): boolean {
  const type = String(event.type ?? "");
  return type === "agent_start" || type === "tool_execution_start" || type === "tool_execution_end";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

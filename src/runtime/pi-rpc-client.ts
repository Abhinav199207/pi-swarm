import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export type PiRpcClientOptions = {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  idleTimeoutMs?: number;
  commandTimeoutMs?: number;
};

type PendingRequest = {
  resolve: (value: RpcResponse) => void;
  reject: (error: Error) => void;
};

type RpcResponse = {
  type: "response";
  id?: string;
  command?: string;
  success: boolean;
  error?: string;
  data?: unknown;
};

export class PiRpcClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private stopReadingStdout: (() => void) | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private eventListeners: Array<(event: Record<string, unknown>) => void> = [];
  private requestId = 0;
  private stderr = "";
  private exitError: Error | null = null;

  constructor(private readonly options: PiRpcClientOptions) {}

  async start(): Promise<void> {
    if (this.process) throw new Error("Pi RPC client already started");

    this.exitError = null;
    this.stderr = "";
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;

    child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderr += chunk.toString();
    });

    child.once("exit", (code, signal) => {
      if (this.process !== child) return;
      const error = this.createExitError(code, signal);
      this.exitError = error;
      this.rejectPending(error);
    });

    child.once("error", (error) => {
      if (this.process !== child) return;
      const processError = new Error(`Pi RPC process error: ${error.message}. Stderr: ${this.stderr}`);
      this.exitError = processError;
      this.rejectPending(processError);
    });

    this.stopReadingStdout = attachJsonlLineReader(child.stdout, (line) => {
      this.handleLine(line);
    });

    await sleep(200);
    if (child.exitCode !== null) {
      throw this.exitError ?? this.createExitError(child.exitCode, child.signalCode);
    }
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    this.stopReadingStdout?.();
    this.stopReadingStdout = null;
    this.process.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.process?.kill("SIGKILL");
        resolve();
      }, 2000);
      this.process?.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.process = null;
    this.pendingRequests.clear();
  }

  onEvent(listener: (event: Record<string, unknown>) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index >= 0) this.eventListeners.splice(index, 1);
    };
  }

  getStderr(): string {
    return this.stderr;
  }

  isRunning(): boolean {
    return this.process != null && this.process.exitCode === null;
  }

  async prompt(message: string): Promise<void> {
    const response = await this.send({ type: "prompt", message });
    if (!response.success) {
      throw new Error(response.error ?? "prompt rejected");
    }
  }

  async waitForIdle(timeoutMs = this.options.idleTimeoutMs ?? 120_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Pi RPC idle timeout after ${timeoutMs}ms. Stderr: ${this.stderr}`));
      }, timeoutMs);
      const unsubscribe = this.onEvent((event) => {
        if (event.type === "agent_settled") {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
    });
  }

  async getLastAssistantText(): Promise<string | null> {
    const response = await this.send({ type: "get_last_assistant_text" });
    if (!response.success) {
      throw new Error(response.error ?? "get_last_assistant_text failed");
    }
    const data = response.data as { text?: string | null } | undefined;
    return data?.text ?? null;
  }

  async promptAndGetReply(message: string, timeoutMs?: number): Promise<string> {
    const idlePromise = this.waitForIdle(timeoutMs);
    await this.prompt(message);
    await idlePromise;
    const text = await this.getLastAssistantText();
    if (!text?.trim()) {
      throw new Error("Pi RPC returned empty assistant text");
    }
    return text.trim();
  }

  private handleLine(line: string): void {
    try {
      const data = JSON.parse(line) as RpcResponse & Record<string, unknown>;
      if (data.type === "response" && data.id && this.pendingRequests.has(data.id)) {
        const pending = this.pendingRequests.get(data.id)!;
        this.pendingRequests.delete(data.id);
        pending.resolve(data);
        return;
      }
      for (const listener of this.eventListeners) {
        listener(data);
      }
    } catch {
      // Ignore non-JSON noise on stdout.
    }
  }

  private async send(command: Record<string, unknown>): Promise<RpcResponse> {
    const child = this.process;
    const stdin = child?.stdin;
    if (!child || !stdin) throw new Error("Pi RPC client not started");
    if (this.exitError) throw this.exitError;
    if (child.exitCode !== null) {
      throw this.exitError ?? this.createExitError(child.exitCode, child.signalCode);
    }

    const id = `req_${++this.requestId}`;
    const payload = { ...command, id };
    return new Promise((resolve, reject) => {
      const timeoutMs = this.options.commandTimeoutMs ?? 30_000;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timeout waiting for ${String(command.type)} response`));
      }, timeoutMs);
      this.pendingRequests.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  private createExitError(code: number | null, signal: NodeJS.Signals | null): Error {
    return new Error(`Pi RPC process exited (code=${code} signal=${signal}). Stderr: ${this.stderr}`);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

function attachJsonlLineReader(stream: NodeJS.ReadableStream, onLine: (line: string) => void): () => void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const emitLine = (line: string) => {
    onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  };
  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      emitLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
  };
  const onEnd = () => {
    buffer += decoder.end();
    if (buffer.length > 0) {
      emitLine(buffer);
      buffer = "";
    }
  };
  stream.on("data", onData);
  stream.on("end", onEnd);
  return () => {
    stream.off("data", onData);
    stream.off("end", onEnd);
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

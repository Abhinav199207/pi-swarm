export class MemoryProviderUnavailableError extends Error {
  readonly retryable = true;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "MemoryProviderUnavailableError";
    if (cause instanceof Error) this.cause = cause;
  }
}

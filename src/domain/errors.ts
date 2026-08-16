export class SwarmError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SwarmError";
    this.code = code;
  }
}

export class WebhookConfiguredError extends SwarmError {
  constructor(webhookUrl: string) {
    super("WEBHOOK_CONFIGURED", `Telegram webhook is configured (${webhookUrl}). Remove it explicitly before enabling long polling.`);
  }
}

export class TokenConflictError extends SwarmError {
  constructor() {
    super("TOKEN_CONFLICT", "Another poller is using this bot token (Telegram 409).");
  }
}

export class LeaseConflictError extends SwarmError {
  constructor() {
    super("LEASE_CONFLICT", "Bridge lease is held by another poller.");
  }
}

export class InvalidTokenError extends SwarmError {
  constructor() {
    super("INVALID_TOKEN", "Telegram token is invalid or revoked.");
  }
}

export class PersonaNotFoundError extends SwarmError {
  constructor(slug: string) {
    super("PERSONA_NOT_FOUND", `Persona not found: ${slug}`);
  }
}

export class BridgeNotFoundError extends SwarmError {
  constructor(id: string) {
    super("BRIDGE_NOT_FOUND", `Bridge not found: ${id}`);
  }
}

export class EphemeralTelegramForbiddenError extends SwarmError {
  constructor() {
    super("EPHEMERAL_TELEGRAM_FORBIDDEN", "Ephemeral subagents cannot have Telegram bridges.");
  }
}

export class DuplicateTokenFingerprintError extends SwarmError {
  constructor() {
    super("DUPLICATE_TOKEN_FINGERPRINT", "Token fingerprint already belongs to an existing bridge.");
  }
}

const TELEGRAM_TOKEN_RE = /\d{8,10}:[A-Za-z0-9_-]{20,}/;
const API_KEY_RE = /\b(sk-[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{20,})\b/;
const SUSPICIOUS_COMMAND_RE =
  /\b(ignore (all )?previous|disregard (system|developer)|run tool|execute command|curl |wget |sudo |rm -rf|override permissions)\b/i;

export type SanitizeResult =
  | { ok: true; text: string; suspicious: boolean }
  | { ok: false; reason: string };

export function containsHardExclusion(text: string): boolean {
  if (TELEGRAM_TOKEN_RE.test(text)) return true;
  if (API_KEY_RE.test(text)) return true;
  if (/-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----/.test(text)) return true;
  if (/password\s*[:=]\s*\S+/i.test(text)) return true;
  return false;
}

export function isSuspiciousForInjection(text: string): boolean {
  return SUSPICIOUS_COMMAND_RE.test(text);
}

export function redactSecrets(text: string): string {
  return text
    .replace(TELEGRAM_TOKEN_RE, "[redacted-telegram-token]")
    .replace(API_KEY_RE, "[redacted-api-key]")
    .replace(/password\s*[:=]\s*\S+/gi, "password=[redacted]");
}

export function sanitizeMemoryStatement(text: string): SanitizeResult {
  if (containsHardExclusion(text)) {
    return { ok: false, reason: "hard exclusion: secrets or credentials" };
  }
  const redacted = redactSecrets(text).trim();
  if (!redacted) return { ok: false, reason: "empty after redaction" };
  return { ok: true, text: redacted, suspicious: isSuspiciousForInjection(redacted) };
}

export function sanitizeRecallQuery(text: string, maxLen = 8000): string {
  return redactSecrets(text).slice(0, maxLen);
}

export function shouldExcludeFromInjection(text: string): boolean {
  return isSuspiciousForInjection(text) || containsHardExclusion(text);
}

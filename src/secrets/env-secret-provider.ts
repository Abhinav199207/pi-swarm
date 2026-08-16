import { createHash } from "node:crypto";
import type { SecretProvider } from "./secret-provider.js";

export class EnvSecretProvider implements SecretProvider {
  async resolve(secretRef: string): Promise<string> {
    if (secretRef.startsWith("env://")) {
      const envName = secretRef.slice("env://".length);
      const value = process.env[envName];
      if (!value) throw new Error(`Secret env var not set: ${envName}`);
      return value;
    }
    const direct = process.env[secretRef];
    if (direct) return direct;
    throw new Error(`Unknown secret reference: ${secretRef}`);
  }
}

export function fingerprintToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function redactToken(token: string): string {
  if (token.length <= 8) return "[redacted]";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

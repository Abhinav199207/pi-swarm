import { FakeMemoryProvider } from "./fake-memory-provider.js";
import { RemnicMemoryProvider } from "./remnic-memory-provider.js";

export { MemoryProviderUnavailableError } from "./memory-errors.js";

export interface MemoryProvider {
  recall(input: {
    query: string;
    scopes: string[];
    maxItems: number;
  }): Promise<MemoryRecallItem[]>;

  upsert(input: {
    externalId: string;
    scope: string;
    kind: string;
    content: string;
    metadata: {
      sensitivity: string;
      provenance: Array<{ sourceType: string; sourceRef: string }>;
      confidence: number;
      expiresAt?: string;
    };
  }): Promise<{ memoryId: string }>;

  correct(input: {
    memoryId: string;
    replacement: string;
    reason: string;
  }): Promise<void>;

  delete(input: { memoryId: string; reason: string }): Promise<void>;

  healthCheck(): Promise<{ healthy: boolean; detail?: string }>;
}

export type MemoryRecallItem = {
  memoryId: string;
  scope: string;
  kind: string;
  content: string;
  confidence?: number;
  relevanceScore: number;
  provenanceRefs: string[];
  updatedAt?: string;
};

export function createMemoryProvider(config: {
  provider: "fake" | "remnic";
  remnicEndpoint?: string;
  remnicAuthToken?: string;
  remnicTimeoutMs?: number;
}): MemoryProvider {
  if (config.provider === "fake") {
    return new FakeMemoryProvider();
  }
  return new RemnicMemoryProvider({
    endpoint: config.remnicEndpoint ?? "http://127.0.0.1:4318",
    authToken: config.remnicAuthToken ?? "",
    timeoutMs: config.remnicTimeoutMs ?? 8000,
  });
}

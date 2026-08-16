import type { Persona } from "../domain/persona.js";
import { scopeMatches } from "../memory/scope-matcher.js";
import { MemoryRepository } from "../persistence/repositories/memory-repository.js";
import type { Db } from "../persistence/db.js";

type DefaultPolicy = {
  read: string[];
  writeCandidate: string[];
};

const DEFAULT_POLICIES: Record<string, DefaultPolicy> = {
  concierge: {
    read: [
      "user/preferences/*",
      "user/standing-decisions/*",
      "persona/*/shared-summary/*",
      "project/pi-swarm/*",
    ],
    writeCandidate: ["user/preferences/*", "user/standing-decisions/*", "project/pi-swarm/*"],
  },
  "atlas-infra": {
    read: [
      "persona/atlas-infra/*",
      "project/pi-swarm/*",
      "project/homelab/*",
      "user/preferences/infrastructure/*",
    ],
    writeCandidate: ["persona/atlas-infra/*", "project/homelab/proposed/*"],
  },
  "quant-research": {
    read: ["persona/quant-research/*", "project/trading-research/*"],
    writeCandidate: ["persona/quant-research/*", "project/trading-research/proposed/*"],
  },
};

export class MemoryPolicyService {
  constructor(private readonly db: Db) {}

  async getReadScopes(persona: Persona, runId?: string | null): Promise<string[]> {
    const repo = new MemoryRepository(this.db);
    const grants = await repo.listActiveGrants("persona", persona.id);
    const fromGrants = grants.filter((g) => g.canRead).map((g) => g.scopePattern);
    const defaults = expandPersonaPolicy(persona, "read");
    const runScopes = runId ? [`run/${runId}/*`] : [];
    return unique([...defaults, ...fromGrants, ...runScopes]);
  }

  async getWriteCandidateScopes(persona: Persona, runId?: string | null): Promise<string[]> {
    const repo = new MemoryRepository(this.db);
    const grants = await repo.listActiveGrants("persona", persona.id);
    const fromGrants = grants.filter((g) => g.canProposeWrite).map((g) => g.scopePattern);
    const defaults = expandPersonaPolicy(persona, "writeCandidate");
    const runScopes = runId ? [`run/${runId}/*`] : [];
    return unique([...defaults, ...fromGrants, ...runScopes]);
  }

  async canProposeWrite(persona: Persona, scope: string, runId?: string | null): Promise<boolean> {
    const allowed = await this.getWriteCandidateScopes(persona, runId);
    return allowed.some((pattern) => scopeMatches(pattern, scope));
  }

  async seedDefaultGrants(persona: Persona): Promise<void> {
    const policy = DEFAULT_POLICIES[persona.slug];
    if (!policy) return;
    const repo = new MemoryRepository(this.db);
    for (const pattern of policy.read) {
      await repo.addGrant({
        granteeType: "persona",
        granteeId: persona.id,
        scopePattern: pattern,
        canRead: true,
        canProposeWrite: policy.writeCandidate.some((w) => w === pattern),
      }).catch(() => undefined);
    }
    for (const pattern of policy.writeCandidate) {
      if (policy.read.includes(pattern)) continue;
      await repo.addGrant({
        granteeType: "persona",
        granteeId: persona.id,
        scopePattern: pattern,
        canRead: false,
        canProposeWrite: true,
      }).catch(() => undefined);
    }
  }
}

function expandPersonaPolicy(persona: Persona, kind: "read" | "writeCandidate"): string[] {
  const policy = DEFAULT_POLICIES[persona.slug];
  if (policy) return policy[kind];
  if (persona.kind === "concierge") return DEFAULT_POLICIES.concierge![kind];
  return [
    `persona/${persona.slug}/*`,
    ...(kind === "read" ? [`project/pi-swarm/*`] : []),
  ];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

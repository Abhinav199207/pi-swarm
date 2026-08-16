export type SpawnRequest = {
  parentRunId: string;
  parentPersonaId: string;
  requestedRole: string;
  task: string;
  toolProfile: string;
  workspaceRef: string;
  budget: { timeoutSeconds: number; maxCostUsd: number; maxTurns: number };
  completionContract: { deliverables: string[] };
};

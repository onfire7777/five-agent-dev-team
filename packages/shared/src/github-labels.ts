export const AGENT_LABELS = {
  claimed: "agent:claimed",
  building: "agent:building",
  verifying: "agent:verifying",
  releaseReady: "agent:release-ready",
  blocked: "agent:blocked"
} as const;

export type AgentLabelKey = keyof typeof AGENT_LABELS;

export function parseAgentLabels(labels: string[]) {
  const normalized = new Set(labels.map((label) => label.toLowerCase()));
  return {
    claimed: normalized.has(AGENT_LABELS.claimed),
    building: normalized.has(AGENT_LABELS.building),
    verifying: normalized.has(AGENT_LABELS.verifying),
    releaseReady: normalized.has(AGENT_LABELS.releaseReady),
    blocked: normalized.has(AGENT_LABELS.blocked)
  };
}

export function nextLabelForStage(stage: string): string {
  if (stage === "VERIFY") return AGENT_LABELS.verifying;
  if (stage === "RELEASE") return AGENT_LABELS.releaseReady;
  if (stage === "BLOCKED") return AGENT_LABELS.blocked;
  return AGENT_LABELS.building;
}


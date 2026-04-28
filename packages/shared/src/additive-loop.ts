import {
  AcceptanceDecisionSchema,
  AgentMessageSchema,
  LoopRunSchema,
  OpportunityCandidateSchema,
  ProjectDirectionSchema,
  ProposalArtifactSchema,
  WorkItemSchema,
  type AcceptanceDecision,
  type AgentMessage,
  type LoopRun,
  type OpportunityCandidate,
  type ProjectDirection,
  type ProposalArtifact,
  type WorkItem
} from "./schemas";

type Scope = { projectId: string; repo: string; loopRunId?: string };

export function createInMemoryTeamBus() {
  const messages: AgentMessage[] = [];
  return {
    async publishMessage(message: unknown): Promise<AgentMessage> {
      const parsed = AgentMessageSchema.parse(message);
      messages.push(parsed);
      return parsed;
    },
    async listMessages(scope: Scope): Promise<AgentMessage[]> {
      return messages.filter(
        (message) =>
          message.projectId === scope.projectId &&
          message.repo === scope.repo &&
          (!scope.loopRunId || message.loopRunId === scope.loopRunId)
      );
    }
  };
}

export function createInMemoryLoopRunStore() {
  const runs = new Map<string, LoopRun>();
  return {
    async startLoopRun(input: unknown): Promise<LoopRun> {
      const run = LoopRunSchema.parse(input);
      runs.set(run.id, run);
      return run;
    },
    async advanceLoopRun(id: string, input: unknown): Promise<LoopRun> {
      const current = requireLoopRun(runs, id);
      assertSameScope(current, input);
      const updated = LoopRunSchema.parse({
        ...current,
        ...(input as Record<string, unknown>)
      });
      runs.set(id, updated);
      return updated;
    },
    async closeLoopRun(id: string, input: unknown): Promise<LoopRun> {
      const current = requireLoopRun(runs, id);
      assertSameScope(current, input);
      const updated = LoopRunSchema.parse({
        ...current,
        ...(input as Record<string, unknown>),
        currentStage: "CLOSED"
      });
      runs.set(id, updated);
      return updated;
    }
  };
}

export function createInMemoryDirectionStore() {
  const directions = new Map<string, ProjectDirection>();
  return {
    async upsertDirection(direction: unknown): Promise<ProjectDirection> {
      const parsed = ProjectDirectionSchema.parse(direction);
      directions.set(parsed.id, parsed);
      return parsed;
    },
    async listActiveDirections(scope: { projectId: string; repo: string }): Promise<ProjectDirection[]> {
      return [...directions.values()].filter(
        (direction) => direction.projectId === scope.projectId && direction.repo === scope.repo && direction.active
      );
    },
    async markDirectionConsumed(id: string, consumedAt: string): Promise<ProjectDirection> {
      const direction = directions.get(id);
      if (!direction) throw new Error(`Direction ${id} was not found.`);
      const updated = ProjectDirectionSchema.parse({
        ...direction,
        active: false,
        consumedAt,
        updatedAt: consumedAt
      });
      directions.set(id, updated);
      return updated;
    }
  };
}

export function scoreOpportunityCandidate(candidate: unknown): number {
  const value = candidate as Record<string, unknown>;
  const impact = boundedScore(value.impact, 3);
  const confidence = boundedScore(value.confidence, 3);
  const urgency = boundedScore(value.urgency, 3);
  const implementationSize = boundedScore(value.implementationSize, 3);
  return Math.max(1, Math.min(100, Math.round(impact * 20 + confidence * 12 + urgency * 10 - implementationSize * 7)));
}

export function dedupeOpportunityCandidates(candidates: unknown[]): OpportunityCandidate[] {
  const parsed = candidates.map((candidate) => OpportunityCandidateSchema.parse(candidate));
  const groups = new Map<string, OpportunityCandidate[]>();
  for (const candidate of parsed) {
    const key = [candidate.projectId, candidate.repo, candidate.duplicateKey || candidate.title.toLowerCase()].join(
      "::"
    );
    groups.set(key, [...(groups.get(key) || []), candidate]);
  }

  const deduped: OpportunityCandidate[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => b.score - a.score);
    sorted.forEach((candidate, index) => {
      deduped.push({
        ...candidate,
        status: index === 0 ? candidate.status : "duplicate"
      });
    });
  }
  return deduped;
}

export function evaluateProposalAcceptancePolicy(proposal: unknown, context: unknown = {}) {
  const parsed = ProposalArtifactSchema.parse(proposal);
  const ctx = context as { githubWriteEnabled?: boolean };
  const lowRisk = parsed.riskLevel === "low" || parsed.risks.length === 0;
  const autoAccept = parsed.autoAcceptEligible && lowRisk && ctx.githubWriteEnabled !== true;
  return autoAccept
    ? {
        decision: "auto_accept",
        status: "auto_accepted",
        reason: "Low-risk proposal is eligible for policy auto-accept."
      }
    : {
        decision: "await_human",
        status: "awaiting_acceptance",
        reason: "Proposal requires explicit acceptance before build."
      };
}

export function applyProposalAcceptanceDecision(input: unknown): {
  workItem: WorkItem;
  proposal: ProposalArtifact;
  loopRun: LoopRun;
  decision?: AcceptanceDecision | { decision: string; actor?: string; createdAt?: string };
} {
  const value = input as {
    workItem: unknown;
    proposal: unknown;
    loopRun: unknown;
    decision: unknown;
  };
  const workItem = WorkItemSchema.parse(value.workItem);
  const proposal = ProposalArtifactSchema.parse(value.proposal);
  const rawDecision = value.decision as Record<string, unknown>;
  const fallbackTime = String(
    rawDecision.createdAt || proposal.updatedAt || workItem.updatedAt || new Date().toISOString()
  );
  const loopRun = LoopRunSchema.parse({
    createdAt: fallbackTime,
    updatedAt: fallbackTime,
    ...(value.loopRun as Record<string, unknown>)
  });
  assertSameScope(workItem, proposal);
  assertSameScope(workItem, loopRun);

  const decisionName = String(rawDecision.decision || "");
  if (decisionName === "request_acceptance") {
    return {
      workItem: WorkItemSchema.parse({
        ...workItem,
        state: "AWAITING_ACCEPTANCE",
        updatedAt: rawDecision.createdAt || workItem.updatedAt
      }),
      proposal: ProposalArtifactSchema.parse({
        ...proposal,
        status: "awaiting_acceptance",
        updatedAt: rawDecision.createdAt || proposal.updatedAt
      }),
      loopRun: LoopRunSchema.parse({
        ...loopRun,
        status: "awaiting_acceptance",
        currentStage: "AWAITING_ACCEPTANCE",
        blockingReason: "Proposal needs human acceptance.",
        updatedAt: rawDecision.createdAt || loopRun.updatedAt
      }),
      decision: rawDecision as { decision: string; actor?: string; createdAt?: string }
    };
  }

  const decision = AcceptanceDecisionSchema.parse({
    id: `${proposal.id}-decision`,
    projectId: workItem.projectId,
    repo: workItem.repo,
    workItemId: workItem.id,
    proposalId: proposal.id,
    proposalVersion: proposal.version,
    actor: "human",
    createdAt: new Date().toISOString(),
    ...rawDecision
  });

  if (decision.decision === "accept" || decision.decision === "edit_accept" || decision.decision === "auto_accept") {
    return {
      workItem: WorkItemSchema.parse({ ...workItem, state: "CONTRACT", updatedAt: decision.createdAt }),
      proposal: ProposalArtifactSchema.parse({
        ...proposal,
        status: decision.decision === "auto_accept" ? "auto_accepted" : "accepted",
        updatedAt: decision.createdAt
      }),
      loopRun: LoopRunSchema.parse({
        ...loopRun,
        status: "running",
        currentStage: "CONTRACT",
        blockingReason: undefined,
        updatedAt: decision.createdAt
      }),
      decision
    };
  }

  if (decision.decision === "request_changes") {
    return {
      workItem: WorkItemSchema.parse({ ...workItem, state: "RND", updatedAt: decision.createdAt }),
      proposal: ProposalArtifactSchema.parse({
        ...proposal,
        status: "revision_requested",
        updatedAt: decision.createdAt
      }),
      loopRun: LoopRunSchema.parse({
        ...loopRun,
        status: "running",
        currentStage: "RND",
        blockingReason: undefined,
        updatedAt: decision.createdAt
      }),
      decision
    };
  }

  return {
    workItem: WorkItemSchema.parse({ ...workItem, state: "CLOSED", updatedAt: decision.createdAt }),
    proposal: ProposalArtifactSchema.parse({ ...proposal, status: "rejected", updatedAt: decision.createdAt }),
    loopRun: LoopRunSchema.parse({
      ...loopRun,
      status: "closed",
      currentStage: "CLOSED",
      blockingReason: undefined,
      updatedAt: decision.createdAt
    }),
    decision
  };
}

function requireLoopRun(runs: Map<string, LoopRun>, id: string): LoopRun {
  const run = runs.get(id);
  if (!run) throw new Error(`Loop run ${id} was not found.`);
  return run;
}

function assertSameScope(left: unknown, right: unknown): void {
  const leftRecord = left as { projectId?: unknown; repo?: unknown };
  const rightRecord = right as { projectId?: unknown; repo?: unknown };
  if (leftRecord.projectId !== rightRecord.projectId || leftRecord.repo !== rightRecord.repo) {
    throw new Error("Project/repo scope mismatch.");
  }
}

function boundedScore(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(5, parsed));
}

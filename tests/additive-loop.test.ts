import { describe, expect, it } from "vitest";
import {
  AgentMessageSchema,
  canTransition,
  OpportunityCandidateSchema,
  ProjectDirectionSchema,
  ProposalArtifactSchema,
  type WorkItem
} from "../packages/shared/src";

type AdditiveLoopApis = {
  createInMemoryTeamBus: () => {
    publishMessage: (message: unknown) => Promise<unknown>;
    listMessages: (scope: { projectId: string; repo: string; loopRunId?: string }) => Promise<unknown[]>;
  };
  createInMemoryLoopRunStore: () => {
    startLoopRun: (input: unknown) => Promise<any>;
    advanceLoopRun: (id: string, input: unknown) => Promise<any>;
    closeLoopRun: (id: string, input: unknown) => Promise<any>;
  };
  createInMemoryDirectionStore: () => {
    upsertDirection: (direction: unknown) => Promise<any>;
    listActiveDirections: (scope: { projectId: string; repo: string }) => Promise<any[]>;
    markDirectionConsumed: (id: string, consumedAt: string) => Promise<any>;
  };
  scoreOpportunityCandidate: (candidate: unknown) => number;
  dedupeOpportunityCandidates: (candidates: unknown[]) => unknown[];
  evaluateProposalAcceptancePolicy: (proposal: unknown, context?: unknown) => any;
  applyProposalAcceptanceDecision: (input: unknown) => any;
};

const expectedExports = [
  "createInMemoryTeamBus",
  "createInMemoryLoopRunStore",
  "createInMemoryDirectionStore",
  "scoreOpportunityCandidate",
  "dedupeOpportunityCandidates",
  "evaluateProposalAcceptancePolicy",
  "applyProposalAcceptanceDecision"
];

async function loadAdditiveLoopApis(): Promise<AdditiveLoopApis> {
  const modulePath = "../packages/shared/src/additive-loop";
  let mod: Record<string, unknown>;
  try {
    mod = await import(modulePath);
  } catch (error) {
    throw new Error(
      `Missing additive-loop shared API module at ${modulePath}. Expected exports: ${expectedExports.join(", ")}. ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const missing = expectedExports.filter((name) => typeof mod[name] !== "function");
  if (missing.length) {
    throw new Error(`Additive-loop shared API module is missing expected exports: ${missing.join(", ")}.`);
  }
  return mod as AdditiveLoopApis;
}

const now = "2026-04-26T12:00:00.000Z";

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "WI-additive-1",
    projectId: "owner-repo-a",
    repo: "owner/repo-a",
    title: "Add focused additive-loop tests",
    requestType: "feature",
    priority: "medium",
    state: "PROPOSAL",
    dependencies: [],
    acceptanceCriteria: ["The loop pauses for proposal acceptance before implementation."],
    riskLevel: "medium",
    frontendNeeded: false,
    backendNeeded: true,
    rndNeeded: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("additive loop contract", () => {
  it("allows the proposal acceptance states in the work-item state machine", () => {
    expect(canTransition("RND", "PROPOSAL")).toBe(true);
    expect(canTransition("PROPOSAL", "AWAITING_ACCEPTANCE")).toBe(true);
    expect(canTransition("AWAITING_ACCEPTANCE", "CONTRACT")).toBe(true);
    expect(canTransition("AWAITING_ACCEPTANCE", "RND")).toBe(true);
    expect(canTransition("AWAITING_ACCEPTANCE", "BLOCKED")).toBe(true);
    expect(canTransition("PROPOSAL", "CONTRACT")).toBe(true);
  });

  it("keeps team bus messages schema-valid and isolated by project/repo", async () => {
    const api = await loadAdditiveLoopApis();
    const bus = api.createInMemoryTeamBus();
    const sameLoop = AgentMessageSchema.parse({
      id: "msg-1",
      projectId: "owner-repo-a",
      repo: "owner/repo-a",
      workItemId: "WI-additive-1",
      loopRunId: "loop-1",
      fromAgent: "rnd-architecture-innovation",
      toAgent: "product-delivery-orchestrator",
      type: "research_finding",
      summary: "Found a small, isolated improvement.",
      details: ["Scope is backend-only."],
      decisions: [],
      risks: [],
      requiresResponse: false,
      createdAt: now
    });
    const otherProject = AgentMessageSchema.parse({
      ...sameLoop,
      id: "msg-2",
      projectId: "owner-repo-b",
      repo: "owner/repo-b",
      loopRunId: "loop-2"
    });

    await bus.publishMessage(sameLoop);
    await bus.publishMessage(otherProject);

    await expect(bus.listMessages({ projectId: "owner-repo-a", repo: "owner/repo-a" }))
      .resolves.toMatchObject([{ id: "msg-1", projectId: "owner-repo-a", repo: "owner/repo-a" }]);
  });

  it("records loop run lifecycle without leaking across projects", async () => {
    const api = await loadAdditiveLoopApis();
    const runs = api.createInMemoryLoopRunStore();

    const started = await runs.startLoopRun({
      id: "loop-1",
      projectId: "owner-repo-a",
      repo: "owner/repo-a",
      workItemId: "WI-additive-1",
      triggerSource: "opportunity_engine",
      currentStage: "NEW",
      startRepoSha: "abc123",
      startBranch: "main",
      startClean: true,
      startSynced: true,
      activeAgents: ["product-delivery-orchestrator"],
      createdAt: now,
      updatedAt: now
    });
    const proposal = await runs.advanceLoopRun(started.id, {
      projectId: "owner-repo-a",
      repo: "owner/repo-a",
      currentStage: "PROPOSAL",
      status: "running",
      updatedAt: "2026-04-26T12:05:00.000Z"
    });
    const awaiting = await runs.advanceLoopRun(started.id, {
      projectId: "owner-repo-a",
      repo: "owner/repo-a",
      currentStage: "AWAITING_ACCEPTANCE",
      status: "awaiting_acceptance",
      blockingReason: "Proposal needs human acceptance.",
      updatedAt: "2026-04-26T12:06:00.000Z"
    });
    const closed = await runs.closeLoopRun(started.id, {
      projectId: "owner-repo-a",
      repo: "owner/repo-a",
      status: "closed",
      endRepoSha: "def456",
      closureSummary: "Accepted proposal moved into contract.",
      closedAt: "2026-04-26T12:10:00.000Z",
      updatedAt: "2026-04-26T12:10:00.000Z"
    });

    expect(started.status).toBe("running");
    expect(proposal.currentStage).toBe("PROPOSAL");
    expect(awaiting.status).toBe("awaiting_acceptance");
    expect(closed.closedAt).toBe("2026-04-26T12:10:00.000Z");
    await expect(runs.advanceLoopRun(started.id, {
      projectId: "owner-repo-b",
      repo: "owner/repo-b",
      currentStage: "CONTRACT",
      updatedAt: now
    })).rejects.toThrow(/project|repo|scope/i);
  });

  it("persists active direction by project/repo and marks next-loop direction consumed", async () => {
    const api = await loadAdditiveLoopApis();
    const directions = api.createInMemoryDirectionStore();
    const nextLoopDirection = ProjectDirectionSchema.parse({
      id: "direction-1",
      projectId: "owner-repo-a",
      repo: "owner/repo-a",
      scope: "next_loop",
      content: "Prioritize additive loop test coverage before implementation changes.",
      createdBy: "human",
      active: true,
      createdAt: now,
      updatedAt: now
    });

    await directions.upsertDirection(nextLoopDirection);
    await directions.upsertDirection({ ...nextLoopDirection, id: "direction-2", projectId: "owner-repo-b", repo: "owner/repo-b" });

    expect(await directions.listActiveDirections({ projectId: "owner-repo-a", repo: "owner/repo-a" }))
      .toMatchObject([{ id: "direction-1", content: nextLoopDirection.content }]);

    const consumed = await directions.markDirectionConsumed("direction-1", "2026-04-26T13:00:00.000Z");
    expect(consumed.active).toBe(false);
    expect(consumed.consumedAt).toBe("2026-04-26T13:00:00.000Z");
    expect(await directions.listActiveDirections({ projectId: "owner-repo-a", repo: "owner/repo-a" })).toEqual([]);
  });

  it("scores opportunities deterministically and dedupes only inside the same project/repo", async () => {
    const api = await loadAdditiveLoopApis();
    const base = {
      projectId: "owner-repo-a",
      repo: "owner/repo-a",
      source: "test_gap",
      summary: "Focused tests are missing around additive-loop acceptance.",
      evidence: ["No additive-loop test file exists."],
      duplicateKey: "additive-loop-tests",
      riskLevel: "low",
      status: "suggested",
      createdAt: now,
      updatedAt: now
    };
    const highValue = OpportunityCandidateSchema.parse({
      ...base,
      id: "opp-1",
      title: "Add additive-loop tests",
      score: api.scoreOpportunityCandidate({ ...base, impact: 5, confidence: 5, urgency: 4, implementationSize: 2 }),
      impact: 5,
      confidence: 5,
      urgency: 4,
      implementationSize: 2
    });
    const duplicate = OpportunityCandidateSchema.parse({ ...highValue, id: "opp-2", score: 1 });
    const otherRepo = OpportunityCandidateSchema.parse({
      ...highValue,
      id: "opp-3",
      projectId: "owner-repo-b",
      repo: "owner/repo-b"
    });
    const lowValueScore = api.scoreOpportunityCandidate({ ...base, impact: 1, confidence: 2, urgency: 1, implementationSize: 5 });

    expect(highValue.score).toBeGreaterThan(lowValueScore);
    expect(api.dedupeOpportunityCandidates([duplicate, highValue, otherRepo]))
      .toMatchObject([
        { id: "opp-1", status: "suggested" },
        { id: "opp-2", status: "duplicate" },
        { id: "opp-3", status: "suggested" }
      ]);
  });

  it("requires human acceptance unless proposal policy explicitly allows auto-accept", async () => {
    const api = await loadAdditiveLoopApis();
    const manualProposal = ProposalArtifactSchema.parse({
      id: "proposal-1",
      projectId: "owner-repo-a",
      repo: "owner/repo-a",
      workItemId: "WI-additive-1",
      loopRunId: "loop-1",
      version: 1,
      status: "draft",
      problem: "The loop needs proposal acceptance coverage.",
      researchSummary: "Tests can cover the policy without implementation edits.",
      recommendedApproach: "Add focused tests.",
      rejectedAlternatives: ["Skip tests until implementation lands."],
      taskBreakdown: ["Add team bus, lifecycle, direction, opportunity, and proposal tests."],
      affectedFiles: ["tests/additive-loop.test.ts"],
      acceptanceTrace: ["User requested tests only."],
      validationPlan: ["npm test"],
      risks: ["Transitions not implemented yet."],
      requiredTools: ["local_filesystem"],
      autoAcceptEligible: false,
      createdAt: now,
      updatedAt: now
    });
    const autoProposal = ProposalArtifactSchema.parse({
      ...manualProposal,
      id: "proposal-2",
      risks: [],
      autoAcceptEligible: true
    });

    expect(api.evaluateProposalAcceptancePolicy(manualProposal, { githubWriteEnabled: false }))
      .toMatchObject({ decision: "await_human", status: "awaiting_acceptance" });
    expect(api.evaluateProposalAcceptancePolicy(autoProposal, { githubWriteEnabled: false }))
      .toMatchObject({ decision: "auto_accept", status: "auto_accepted" });
  });

  it("moves PROPOSAL to AWAITING_ACCEPTANCE, then accepted proposals into CONTRACT", async () => {
    const api = await loadAdditiveLoopApis();
    const proposal = ProposalArtifactSchema.parse({
      id: "proposal-1",
      projectId: "owner-repo-a",
      repo: "owner/repo-a",
      workItemId: "WI-additive-1",
      loopRunId: "loop-1",
      version: 1,
      status: "draft",
      problem: "Need an acceptance gate before build.",
      researchSummary: "The gate prevents unreviewed implementation.",
      recommendedApproach: "Pause after proposal.",
      taskBreakdown: ["Wait for accept/edit/request changes/reject."],
      affectedFiles: [],
      acceptanceTrace: ["Human acceptance is required."],
      validationPlan: ["state transition tests"],
      risks: [],
      requiredTools: [],
      autoAcceptEligible: false,
      createdAt: now,
      updatedAt: now
    });

    const awaiting = api.applyProposalAcceptanceDecision({
      workItem: workItem({ state: "PROPOSAL" }),
      proposal,
      loopRun: {
        id: "loop-1",
        projectId: "owner-repo-a",
        repo: "owner/repo-a",
        workItemId: "WI-additive-1",
        status: "running",
        currentStage: "PROPOSAL"
      },
      decision: { decision: "request_acceptance", actor: "policy", createdAt: now }
    });
    expect(awaiting).toMatchObject({
      workItem: { state: "AWAITING_ACCEPTANCE" },
      proposal: { status: "awaiting_acceptance" },
      loopRun: { status: "awaiting_acceptance", currentStage: "AWAITING_ACCEPTANCE" }
    });

    const accepted = api.applyProposalAcceptanceDecision({
      workItem: workItem({ state: "AWAITING_ACCEPTANCE" }),
      proposal: { ...proposal, status: "awaiting_acceptance" },
      loopRun: { ...awaiting.loopRun },
      decision: {
        id: "decision-1",
        projectId: "owner-repo-a",
        repo: "owner/repo-a",
        workItemId: "WI-additive-1",
        proposalId: "proposal-1",
        decision: "accept",
        actor: "human",
        createdAt: "2026-04-26T12:15:00.000Z"
      }
    });
    expect(accepted).toMatchObject({
      workItem: { state: "CONTRACT" },
      proposal: { status: "accepted" },
      loopRun: { status: "running", currentStage: "CONTRACT" }
    });

    const revised = api.applyProposalAcceptanceDecision({
      workItem: workItem({ state: "AWAITING_ACCEPTANCE" }),
      proposal: { ...proposal, status: "awaiting_acceptance" },
      loopRun: { ...awaiting.loopRun },
      decision: {
        id: "decision-2",
        projectId: "owner-repo-a",
        repo: "owner/repo-a",
        workItemId: "WI-additive-1",
        proposalId: "proposal-1",
        decision: "request_changes",
        actor: "human",
        feedback: "Clarify the rollback plan before build.",
        createdAt: "2026-04-26T12:16:00.000Z"
      }
    });
    expect(revised).toMatchObject({
      workItem: { state: "RND" },
      proposal: { status: "revision_requested" },
      loopRun: { status: "running", currentStage: "RND" }
    });
  });
});

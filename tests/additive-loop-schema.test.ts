import { describe, expect, it } from "vitest";
import {
  AcceptanceDecisionSchema,
  AgentHeartbeatSchema,
  AgentMessageSchema,
  AgentTaskLeaseSchema,
  LoopRunSchema,
  OpportunityCandidateSchema,
  OpportunityScanRunSchema,
  ProjectDirectionSchema,
  ProposalArtifactSchema,
  TeamContextSnapshotSchema
} from "../packages/shared/src";

const now = new Date().toISOString();

const scope = {
  projectId: "project-owner-repo",
  repo: "owner/repo",
  workItemId: "WI-2000",
  loopRunId: "LOOP-2000"
};

describe("additive autonomous loop schemas", () => {
  it("validates durable team-bus messages with explicit loop scope", () => {
    const message = AgentMessageSchema.parse({
      id: "MSG-1",
      ...scope,
      fromAgent: "rnd-architecture-innovation",
      toAgent: "backend-systems-engineering",
      type: "contract_question",
      summary: "Confirm response shape before backend implementation.",
      details: ["Frontend needs stable empty and error states."],
      createdAt: now
    });

    expect(message.loopRunId).toBe(scope.loopRunId);
    expect(message.requiresResponse).toBe(false);
  });

  it("blocks cross-project or cross-loop messages from team context snapshots", () => {
    const validMessage = AgentMessageSchema.parse({
      id: "MSG-2",
      ...scope,
      fromAgent: "quality-security-privacy-release",
      type: "verification_result",
      summary: "Verification plan is ready.",
      createdAt: now
    });
    const validSnapshot = TeamContextSnapshotSchema.parse({
      id: "CTX-1",
      ...scope,
      summary: "Current loop context",
      activeGoal: "Ship a low-risk hardening fix.",
      recentMessages: [validMessage],
      updatedAt: now
    });

    expect(validSnapshot.recentMessages).toHaveLength(1);
    expect(() =>
      TeamContextSnapshotSchema.parse({
        id: "CTX-2",
        ...scope,
        summary: "Invalid mixed-project context",
        activeGoal: "Ship a low-risk hardening fix.",
        recentMessages: [{ ...validMessage, projectId: "another-project" }],
        updatedAt: now
      })
    ).toThrow();
  });

  it("validates loop runs, heartbeats, and task leases for continuous coordination", () => {
    const loopRun = LoopRunSchema.parse({
      id: scope.loopRunId,
      projectId: scope.projectId,
      repo: scope.repo,
      memoryNamespace: "owner-repo",
      workItemId: scope.workItemId,
      triggerSource: "opportunity_engine",
      currentStage: "PROPOSAL",
      startRepoSha: "abc123",
      startBranch: "main",
      startClean: true,
      startSynced: true,
      activeAgents: ["product-delivery-orchestrator", "rnd-architecture-innovation"],
      createdAt: now,
      updatedAt: now
    });
    const heartbeat = AgentHeartbeatSchema.parse({
      id: "HB-1",
      projectId: scope.projectId,
      repo: scope.repo,
      loopRunId: scope.loopRunId,
      agent: "frontend-ux-engineering",
      updatedAt: now
    });
    const lease = AgentTaskLeaseSchema.parse({
      id: "LEASE-1",
      ...scope,
      agent: "rnd-architecture-innovation",
      stage: "PROPOSAL",
      task: "Draft implementation proposal",
      purpose: "proposal",
      leasedAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });

    expect(loopRun.status).toBe("running");
    expect(heartbeat.currentTask).toContain("available");
    expect(lease.status).toBe("active");
  });

  it("validates project direction and opportunity discovery records", () => {
    const direction = ProjectDirectionSchema.parse({
      id: "DIR-1",
      projectId: scope.projectId,
      repo: scope.repo,
      scope: "standing",
      content: "Prefer reliability, security, tests, and performance before adding net-new features.",
      createdAt: now,
      updatedAt: now
    });
    const candidate = OpportunityCandidateSchema.parse({
      id: "OPP-1",
      projectId: scope.projectId,
      repo: scope.repo,
      source: "failed_ci",
      title: "Stabilize failing CI",
      summary: "Recent CI failures should be fixed before new feature work.",
      evidence: ["GitHub Actions failed on main."],
      duplicateKey: "failed_ci:main",
      score: 92,
      riskLevel: "low",
      suggestedRequestType: "bug",
      createdAt: now,
      updatedAt: now
    });
    const scan = OpportunityScanRunSchema.parse({
      id: "SCAN-1",
      projectId: scope.projectId,
      repo: scope.repo,
      sources: ["failed_ci", "repo_memory"],
      repoSha: "abc123",
      memoryVersion: "mem-2026-04-26",
      candidatesCreated: 1,
      summary: "One candidate found.",
      startedAt: now,
      completedAt: now
    });

    expect(direction.active).toBe(true);
    expect(candidate.status).toBe("suggested");
    expect(scan.status).toBe("complete");
  });

  it("validates proposal artifacts and acceptance decisions before build starts", () => {
    const proposal = ProposalArtifactSchema.parse({
      id: "PROP-1",
      ...scope,
      problem: "The loop needs explicit proposal evidence before implementation.",
      researchSummary: "Existing artifacts support an additive proposal gate.",
      recommendedApproach: "Add shared schema and state support without touching runtime services.",
      rejectedAlternatives: ["Replacing the current workflow"],
      taskBreakdown: ["Add schema contracts", "Add state transitions", "Add tests"],
      buildContract: ["No controller, worker, or dashboard changes"],
      acceptanceCriteria: ["New states parse", "Proposal decisions parse", "State machine allows proposal flow"],
      validationPlan: ["npm test -- additive-loop-schema state-machine"],
      riskLevel: "low",
      autoAcceptEligible: true,
      createdAt: now,
      updatedAt: now
    });
    const decision = AcceptanceDecisionSchema.parse({
      id: "DEC-1",
      projectId: scope.projectId,
      repo: scope.repo,
      workItemId: scope.workItemId,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      decision: "auto_accept",
      actor: "policy",
      policyReason: "Low-risk shared contract addition with direct tests.",
      createdAt: now
    });

    expect(proposal.version).toBe(1);
    expect(proposal.requiresHumanAcceptance).toBe(false);
    expect(decision.actor).toBe("policy");
  });
});

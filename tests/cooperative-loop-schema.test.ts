import { describe, expect, it } from "vitest";
import {
  AcceptanceDecisionSchema,
  AgentHeartbeatSchema,
  AgentMessageSchema,
  AgentTaskLeaseSchema,
  LoopRunSchema,
  OpportunityCandidateSchema,
  ProjectDirectionSchema,
  ProposalArtifactSchema,
  TeamContextSnapshotSchema,
  WorkItemSchema
} from "../packages/shared/src";

describe("cooperative loop schemas", () => {
  const now = new Date().toISOString();

  it("validates proposal and acceptance workflow state data", () => {
    const workItem = WorkItemSchema.parse({
      id: "WI-2000",
      projectId: "sample-project",
      repo: "sample/repo",
      title: "Add cooperative proposal gate",
      state: "PROPOSAL",
      createdAt: now,
      updatedAt: now
    });
    const proposal = ProposalArtifactSchema.parse({
      id: "proposal-2000",
      projectId: "sample-project",
      repo: "sample/repo",
      workItemId: workItem.id,
      loopRunId: "loop-2000",
      status: "awaiting_acceptance",
      problem: "Agents need a reviewable proposal before implementation starts.",
      researchSummary: "Prior loop evidence supports a proposal gate.",
      recommendedApproach: "Persist a proposal artifact and wait for acceptance.",
      taskBreakdown: ["Create shared schema", "Store acceptance decision"],
      acceptanceTrace: ["User accepts before CONTRACT"],
      validationPlan: ["npm test"],
      createdAt: now,
      updatedAt: now
    });
    const decision = AcceptanceDecisionSchema.parse({
      id: "decision-2000",
      projectId: "sample-project",
      repo: "sample/repo",
      workItemId: workItem.id,
      proposalId: proposal.id,
      decision: "accept",
      actor: "human",
      feedback: "Proceed with this implementation plan.",
      createdAt: now
    });

    expect(workItem.state).toBe("PROPOSAL");
    expect(proposal.status).toBe("awaiting_acceptance");
    expect(decision.decision).toBe("accept");
  });

  it("validates team context, messages, heartbeats, leases, and loop run snapshots", () => {
    const message = AgentMessageSchema.parse({
      id: "msg-1",
      projectId: "sample-project",
      repo: "sample/repo",
      workItemId: "WI-2001",
      loopRunId: "loop-2001",
      fromAgent: "rnd-architecture-innovation",
      toAgent: "product-delivery-orchestrator",
      type: "research_finding",
      summary: "Proposal gate should be explicit.",
      details: ["Keep implementation blocked until acceptance."],
      createdAt: now
    });
    const heartbeat = AgentHeartbeatSchema.parse({
      id: "hb-1",
      projectId: "sample-project",
      repo: "sample/repo",
      loopRunId: "loop-2001",
      workItemId: "WI-2001",
      agent: "product-delivery-orchestrator",
      status: "working",
      currentTask: "Review proposal readiness",
      updatedAt: now
    });
    const lease = AgentTaskLeaseSchema.parse({
      id: "lease-1",
      projectId: "sample-project",
      repo: "sample/repo",
      loopRunId: "loop-2001",
      workItemId: "WI-2001",
      agent: "product-delivery-orchestrator",
      stage: "AWAITING_ACCEPTANCE",
      task: "Coordinate acceptance gate",
      leasedAt: now,
      expiresAt: now
    });
    const direction = ProjectDirectionSchema.parse({
      id: "direction-1",
      projectId: "sample-project",
      repo: "sample/repo",
      content: "Prioritize additive local-first cooperative loop support.",
      createdBy: "human",
      createdAt: now,
      updatedAt: now
    });
    const opportunity = OpportunityCandidateSchema.parse({
      id: "opp-1",
      projectId: "sample-project",
      repo: "sample/repo",
      source: "human_direction",
      title: "Add acceptance handoff",
      summary: "Accepted proposals should pass into implementation.",
      duplicateKey: "sample/repo:add-acceptance-handoff",
      score: 88,
      createdAt: now,
      updatedAt: now
    });
    const snapshot = TeamContextSnapshotSchema.parse({
      id: "snapshot-1",
      projectId: "sample-project",
      repo: "sample/repo",
      workItemId: "WI-2001",
      loopRunId: "loop-2001",
      summary: "Team is awaiting acceptance before implementation.",
      activeGoal: "Implement cooperative proposal gate",
      activeDirection: [direction.content],
      recentMessages: [message],
      updatedAt: now
    });
    const loopRun = LoopRunSchema.parse({
      id: "loop-2001",
      projectId: "sample-project",
      repo: "sample/repo",
      workItemId: "WI-2001",
      status: "awaiting_acceptance",
      currentStage: "AWAITING_ACCEPTANCE",
      activeAgents: [heartbeat.agent],
      createdAt: now,
      updatedAt: now
    });

    expect(message.requiresResponse).toBe(false);
    expect(heartbeat.status).toBe("working");
    expect(lease.status).toBe("active");
    expect(direction.active).toBe(true);
    expect(opportunity.status).toBe("suggested");
    expect(snapshot.recentMessages).toHaveLength(1);
    expect(loopRun.currentStage).toBe("AWAITING_ACCEPTANCE");
  });
});

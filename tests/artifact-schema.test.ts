import { describe, expect, it } from "vitest";
import { ReleasePacketSchema, StageArtifactSchema, WorkItemBriefSchema } from "../packages/shared/src";

describe("stage artifact schema", () => {
  it("validates the machine-readable stage contract", () => {
    const artifact = StageArtifactSchema.parse({
      workItemId: "WI-1000",
      stage: "VERIFY",
      ownerAgent: "quality-security-privacy-release",
      status: "passed",
      title: "Verification Report",
      summary: "All checks passed.",
      decisions: ["Proceed to release gate"],
      risks: [],
      filesChanged: [],
      testsRun: ["npm test"],
      releaseReadiness: "ready",
      nextStage: "RELEASE",
      createdAt: new Date().toISOString()
    });

    expect(artifact.ownerAgent).toBe("quality-security-privacy-release");
  });

  it("validates loop start and loop closure lifecycle artifacts", () => {
    const createdAt = new Date().toISOString();
    const loopStart = StageArtifactSchema.parse({
      workItemId: "WI-1001",
      projectId: "owner-repo",
      repo: "owner/repo",
      stage: "NEW",
      ownerAgent: "product-delivery-orchestrator",
      status: "passed",
      title: "Loop start snapshot",
      summary: "Loop start captured latest state before intake.",
      decisions: ["Local Git is clean and synced."],
      risks: [],
      filesChanged: [],
      testsRun: ["git-sync:passed"],
      releaseReadiness: "unknown",
      nextStage: "INTAKE",
      createdAt
    });
    const loopClosure = StageArtifactSchema.parse({
      workItemId: "WI-1001",
      projectId: "owner-repo",
      repo: "owner/repo",
      stage: "CLOSED",
      ownerAgent: "product-delivery-orchestrator",
      status: "passed",
      title: "Loop closure summary",
      summary: "Loop complete and remembered.",
      decisions: ["Persist this closure as the repo latest-loop memory."],
      risks: [],
      filesChanged: ["src/index.ts"],
      testsRun: ["git-sync:passed", "github-actions:passed"],
      releaseReadiness: "ready",
      nextStage: null,
      createdAt
    });

    expect(loopStart.nextStage).toBe("INTAKE");
    expect(loopClosure.stage).toBe("CLOSED");
  });

  it("requires typed release rollback instructions", () => {
    const packet = ReleasePacketSchema.parse({
      workItemId: "WI-1002",
      projectId: "owner-repo",
      tag: "agent-wi-1002",
      releaseNotes: "Release passed.",
      gates: [{ name: "release-command", passed: true, evidence: "gh release create passed." }],
      rollback: {
        command: 'gh release delete "agent-wi-1002" --yes --cleanup-tag',
        verification: "Verify the release and tag no longer exist."
      },
      recommendation: "go"
    });

    expect(packet.rollback.command).toContain("gh release delete");
  });

  it("accepts real work item brief identifiers", () => {
    expect(
      WorkItemBriefSchema.parse({
        workItemId: "WI-3000",
        projectId: "owner-repo",
        title: "Scoped work",
        requestType: "research",
        priority: "p1",
        businessGoal: "ship",
        userGoal: "use",
        technicalGoal: "build",
        scopeIn: [],
        scopeOut: [],
        acceptanceCriteria: [],
        affectedAreas: ["backend"],
        flags: { frontendNeeded: false, backendNeeded: true, rndNeeded: true },
        riskLevels: { securityPrivacy: "medium", performance: "medium" },
        openQuestions: [],
        routingDecision: "research"
      })
    ).toMatchObject({ workItemId: "WI-3000", projectId: "owner-repo" });
  });

  it("rejects malformed work item briefs before agent routing", () => {
    expect(() =>
      WorkItemBriefSchema.parse({
        workItemId: "not-a-uuid",
        projectId: "not-a-uuid",
        title: "",
        requestType: "feature",
        priority: "p1",
        businessGoal: "ship",
        userGoal: "use",
        technicalGoal: "build",
        scopeIn: [],
        scopeOut: [],
        acceptanceCriteria: [],
        affectedAreas: ["backend"],
        flags: { frontendNeeded: false, backendNeeded: true, rndNeeded: false },
        riskLevels: { securityPrivacy: "medium", performance: "medium" },
        openQuestions: [],
        routingDecision: "backend"
      })
    ).toThrow();
  });
});

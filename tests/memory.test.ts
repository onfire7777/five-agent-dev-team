import { describe, expect, it } from "vitest";
import {
  createSampleArtifacts,
  createSampleWorkItems,
  memoryFromArtifact,
  selectRelevantMemories,
  type MemoryRecord
} from "../packages/shared/src";

describe("permanent smart memory", () => {
  it("promotes important artifact decisions into durable memory", () => {
    const memories = memoryFromArtifact(createSampleArtifacts()[0]);
    expect(memories.some((memory) => memory.permanence === "permanent")).toBe(true);
  });

  it("promotes research, release, failure, and handoff records", () => {
    const releaseArtifact = {
      ...createSampleArtifacts()[1],
      stage: "RELEASE" as const,
      status: "blocked" as const,
      nextStage: "BLOCKED" as const
    };
    const memories = [...memoryFromArtifact(createSampleArtifacts()[0]), ...memoryFromArtifact(releaseArtifact)];
    expect(memories.some((memory) => memory.kind === "research")).toBe(true);
    expect(memories.some((memory) => memory.kind === "release")).toBe(true);
    expect(memories.some((memory) => memory.kind === "failure")).toBe(true);
    expect(memories.some((memory) => memory.kind === "handoff")).toBe(true);
  });

  it("promotes successful closure into permanent repo latest-state memory", () => {
    const closureArtifact = {
      ...createSampleArtifacts()[0],
      stage: "CLOSED" as const,
      ownerAgent: "product-delivery-orchestrator" as const,
      status: "passed" as const,
      title: "Loop closure summary",
      summary: "Loop complete. Latest repo state is remembered for the next loop.",
      decisions: ["Persist this closure as the repo latest-loop memory."],
      testsRun: ["git-sync:passed", "github-actions:passed"],
      releaseReadiness: "ready" as const,
      nextStage: null
    };
    const latest = memoryFromArtifact(closureArtifact).find((memory) => memory.tags.includes("latest-loop"));

    expect(latest).toMatchObject({
      scope: "repo",
      key: "latest_completed_loop",
      projectId: closureArtifact.projectId,
      repo: closureArtifact.repo,
      kind: "handoff",
      permanence: "permanent",
      importance: 5,
      workItemId: undefined,
      supersededBy: null
    });
    expect(latest?.content).toContain("Loop complete");
  });

  it("excludes superseded keyed memories from relevant context", () => {
    const workItem = createSampleWorkItems()[0];
    const now = new Date().toISOString();
    const oldMemory: MemoryRecord = {
      id: "latest-loop-old",
      scope: "repo",
      key: "latest_completed_loop",
      projectId: workItem.projectId,
      repo: workItem.repo,
      kind: "handoff",
      title: "Old loop state",
      content: "Old state",
      tags: ["latest-loop"],
      confidence: "high",
      importance: 5,
      permanence: "permanent",
      source: "test",
      createdAt: now,
      updatedAt: now,
      supersededBy: "latest-loop-new"
    };
    const newMemory: MemoryRecord = {
      ...oldMemory,
      id: "latest-loop-new",
      title: "New loop state",
      content: "New state",
      supersededBy: null
    };

    expect(selectRelevantMemories([oldMemory, newMemory], workItem, 2).map((memory) => memory.id)).toEqual([
      "latest-loop-new"
    ]);
  });

  it("retrieves relevant non-expired memories by importance", () => {
    const workItem = createSampleWorkItems()[1];
    const memories = memoryFromArtifact(createSampleArtifacts()[0]);
    const selected = selectRelevantMemories(memories, workItem, 3);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected[0].importance).toBeGreaterThanOrEqual(selected[selected.length - 1].importance);
  });

  it("includes repo-scoped durable memory in the v1 single-repo context", () => {
    const workItem = createSampleWorkItems()[0];
    const now = new Date().toISOString();
    const repoMemory: MemoryRecord = {
      id: "repo-architecture",
      scope: "repo",
      projectId: workItem.projectId,
      repo: workItem.repo,
      kind: "architecture",
      title: "Repo architecture",
      content: "Use Temporal for durable orchestration.",
      tags: [],
      confidence: "high",
      importance: 5,
      permanence: "permanent",
      source: "test",
      createdAt: now,
      updatedAt: now
    };

    expect(selectRelevantMemories([repoMemory], workItem, 1)).toEqual([repoMemory]);
  });

  it("excludes repo-scoped memory that has no connected project or repo scope", () => {
    const workItem = createSampleWorkItems()[0];
    const now = new Date().toISOString();
    const repoMemory: MemoryRecord = {
      id: "unscoped-repo-architecture",
      scope: "repo",
      kind: "architecture",
      title: "Repo architecture",
      content: "This must not leak into connected projects.",
      tags: [],
      confidence: "high",
      importance: 5,
      permanence: "permanent",
      source: "test",
      createdAt: now,
      updatedAt: now
    };

    expect(selectRelevantMemories([repoMemory], workItem, 1)).toEqual([]);
  });
});

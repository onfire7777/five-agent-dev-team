import { describe, expect, it } from "vitest";
import { createSampleArtifacts, createSampleWorkItems, memoryFromArtifact, selectRelevantMemories, type MemoryRecord } from "../packages/shared/src";

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
    const memories = [
      ...memoryFromArtifact(createSampleArtifacts()[0]),
      ...memoryFromArtifact(releaseArtifact)
    ];
    expect(memories.some((memory) => memory.kind === "research")).toBe(true);
    expect(memories.some((memory) => memory.kind === "release")).toBe(true);
    expect(memories.some((memory) => memory.kind === "failure")).toBe(true);
    expect(memories.some((memory) => memory.kind === "handoff")).toBe(true);
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

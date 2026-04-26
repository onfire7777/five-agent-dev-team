import { describe, expect, it } from "vitest";
import { buildSharedContext, createSampleArtifacts, createSampleWorkItems, formatSharedContext, type MemoryRecord } from "../packages/shared/src";

describe("shared team context", () => {
  it("builds teammate and research awareness from prior artifacts", () => {
    const workItem = createSampleWorkItems().find((item) => item.id === "WI-1290")!;
    const context = buildSharedContext(workItem, createSampleArtifacts());

    expect(context.teammateActivity.length).toBeGreaterThan(0);
    expect(context.researchFindings.length).toBeGreaterThan(0);
    expect(formatSharedContext(context)).toContain("Teammate activity");
  });

  it("surfaces latest-loop closure memory as agent context", () => {
    const workItem = createSampleWorkItems()[0];
    const now = new Date().toISOString();
    const latestLoop: MemoryRecord = {
      id: "latest-loop-test",
      scope: "repo",
      projectId: workItem.projectId,
      repo: workItem.repo,
      kind: "handoff",
      title: "Latest completed loop state",
      content: "Loop complete; local Git, Docker runtime, and GitHub Actions were synced.",
      tags: ["latest-loop", "loop-closure"],
      confidence: "high",
      importance: 5,
      permanence: "permanent",
      source: "product-delivery-orchestrator:CLOSED",
      createdAt: now,
      updatedAt: now
    };
    const context = buildSharedContext(workItem, [], [latestLoop]);

    expect(formatSharedContext(context)).toContain("Latest completed loop state");
    expect(context.contextNotes[0]).toContain("Loop complete");
  });
});

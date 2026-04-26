import { describe, expect, it } from "vitest";
import { createSampleArtifacts, createSampleWorkItems, memoryFromArtifact, selectRelevantMemories } from "../packages/shared/src";

describe("permanent smart memory", () => {
  it("promotes important artifact decisions into durable memory", () => {
    const memories = memoryFromArtifact(createSampleArtifacts()[0]);
    expect(memories.some((memory) => memory.permanence === "permanent")).toBe(true);
  });

  it("retrieves relevant non-expired memories by importance", () => {
    const workItem = createSampleWorkItems()[1];
    const memories = memoryFromArtifact(createSampleArtifacts()[0]);
    const selected = selectRelevantMemories(memories, workItem, 3);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected[0].importance).toBeGreaterThanOrEqual(selected[selected.length - 1].importance);
  });
});

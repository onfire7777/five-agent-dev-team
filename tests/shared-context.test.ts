import { describe, expect, it } from "vitest";
import { buildSharedContext, createSampleArtifacts, createSampleWorkItems, formatSharedContext } from "../packages/shared/src";

describe("shared team context", () => {
  it("builds teammate and research awareness from prior artifacts", () => {
    const workItem = createSampleWorkItems().find((item) => item.id === "WI-1290")!;
    const context = buildSharedContext(workItem, createSampleArtifacts());

    expect(context.teammateActivity.length).toBeGreaterThan(0);
    expect(context.researchFindings.length).toBeGreaterThan(0);
    expect(formatSharedContext(context)).toContain("Teammate activity");
  });
});

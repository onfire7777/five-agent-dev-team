import { describe, expect, it } from "vitest";
import { StageArtifactSchema } from "../packages/shared/src";

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
});

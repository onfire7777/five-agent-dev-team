import { describe, expect, it } from "vitest";
import { AGENT_LABELS, nextLabelForStage, parseAgentLabels } from "../packages/shared/src";

describe("GitHub labels", () => {
  it("parses agent ownership labels", () => {
    expect(parseAgentLabels([AGENT_LABELS.claimed, AGENT_LABELS.verifying])).toMatchObject({
      claimed: true,
      verifying: true,
      releaseReady: false
    });
  });

  it("maps stages to active labels", () => {
    expect(nextLabelForStage("VERIFY")).toBe(AGENT_LABELS.verifying);
    expect(nextLabelForStage("RELEASE")).toBe(AGENT_LABELS.releaseReady);
    expect(nextLabelForStage("BLOCKED")).toBe(AGENT_LABELS.blocked);
  });
});

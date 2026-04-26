import { describe, expect, it } from "vitest";
import { ALL_WORK_ITEM_STATES, canTransition, nextStates, WORKFLOW_SEQUENCE } from "../packages/shared/src";

describe("work item state machine", () => {
  it("allows the normal autonomous delivery path", () => {
    expect(canTransition("NEW", "INTAKE")).toBe(true);
    expect(canTransition("INTAKE", "RND")).toBe(true);
    expect(canTransition("RND", "CONTRACT")).toBe(true);
    expect(canTransition("INTEGRATION", "VERIFY")).toBe(true);
    expect(canTransition("RELEASE", "CLOSED")).toBe(true);
  });

  it("does not allow closed work to restart implicitly", () => {
    expect(nextStates("CLOSED")).toEqual([]);
    expect(canTransition("CLOSED", "RELEASE")).toBe(false);
  });

  it("keeps blocked state explicit outside the happy path", () => {
    expect(WORKFLOW_SEQUENCE).not.toContain("BLOCKED");
    expect(ALL_WORK_ITEM_STATES).toContain("BLOCKED");
  });
});

import { describe, expect, it } from "vitest";
import { canTransition, nextStates } from "../packages/shared/src";

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
});

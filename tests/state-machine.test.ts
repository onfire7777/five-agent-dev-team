import { describe, expect, it } from "vitest";
import {
  ALL_WORK_ITEM_STATES,
  canTransition,
  isActiveWorkItemState,
  isProposalGateState,
  isTerminalWorkItemState,
  nextStates,
  PROPOSAL_GATE_STATES,
  TERMINAL_WORK_ITEM_STATES,
  WORKFLOW_SEQUENCE
} from "../packages/shared/src";

describe("work item state machine", () => {
  it("allows the normal autonomous delivery path", () => {
    expect(canTransition("NEW", "INTAKE")).toBe(true);
    expect(canTransition("INTAKE", "RND")).toBe(true);
    expect(canTransition("RND", "CONTRACT")).toBe(true);
    expect(canTransition("RND", "PROPOSAL")).toBe(true);
    expect(canTransition("PROPOSAL", "AWAITING_ACCEPTANCE")).toBe(true);
    expect(canTransition("AWAITING_ACCEPTANCE", "CONTRACT")).toBe(true);
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

  it("keeps proposal and acceptance gates in the ordered workflow", () => {
    expect(WORKFLOW_SEQUENCE).toEqual([
      "NEW",
      "INTAKE",
      "RND",
      "PROPOSAL",
      "AWAITING_ACCEPTANCE",
      "CONTRACT",
      "FRONTEND_BUILD",
      "BACKEND_BUILD",
      "INTEGRATION",
      "VERIFY",
      "RELEASE",
      "CLOSED"
    ]);
    expect(nextStates("PROPOSAL")).toContain("AWAITING_ACCEPTANCE");
    expect(nextStates("AWAITING_ACCEPTANCE")).toContain("RND");
  });

  it("supports proposal acceptance and revision paths before build contract", () => {
    expect(canTransition("PROPOSAL", "CONTRACT")).toBe(true);
    expect(canTransition("PROPOSAL", "RND")).toBe(true);
    expect(canTransition("AWAITING_ACCEPTANCE", "CLOSED")).toBe(true);
    expect(canTransition("FRONTEND_BUILD", "PROPOSAL")).toBe(false);
  });

  it("classifies proposal gates and terminal states", () => {
    expect(PROPOSAL_GATE_STATES).toEqual(["PROPOSAL", "AWAITING_ACCEPTANCE"]);
    expect(TERMINAL_WORK_ITEM_STATES).toEqual(["CLOSED", "BLOCKED"]);
    expect(isProposalGateState("PROPOSAL")).toBe(true);
    expect(isProposalGateState("CONTRACT")).toBe(false);
    expect(isTerminalWorkItemState("CLOSED")).toBe(true);
    expect(isTerminalWorkItemState("VERIFY")).toBe(false);
    expect(isActiveWorkItemState("AWAITING_ACCEPTANCE")).toBe(true);
    expect(isActiveWorkItemState("NEW")).toBe(false);
  });
});

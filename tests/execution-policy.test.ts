import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULER_POLICY, dependenciesSatisfied, getBlockingWorkItemIds, selectNextWorkItem, selectParallelWorkItems, shouldUseLiveApi, type WorkItem } from "../packages/shared/src";

const base: WorkItem = {
  id: "WI-1",
  title: "Base",
  requestType: "feature",
  priority: "medium",
  state: "NEW",
  dependencies: [],
  acceptanceCriteria: [],
  riskLevel: "medium",
  frontendNeeded: true,
  backendNeeded: true,
  rndNeeded: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

describe("smart scheduler policy", () => {
  it("prioritizes urgent active work and skips closed work", () => {
    const next = selectNextWorkItem([
      { ...base, id: "WI-closed", priority: "urgent", state: "CLOSED" },
      { ...base, id: "WI-low", priority: "low" },
      { ...base, id: "WI-urgent", priority: "urgent" }
    ], DEFAULT_SCHEDULER_POLICY);

    expect(next?.id).toBe("WI-urgent");
  });

  it("uses live API only when explicitly configured", () => {
    expect(shouldUseLiveApi(DEFAULT_SCHEDULER_POLICY)).toBe(false);
    expect(shouldUseLiveApi({ ...DEFAULT_SCHEDULER_POLICY, mode: "api_live" })).toBe(true);
  });

  it("selects one work item by default so the current loop finishes before the next starts", () => {
    const selected = selectParallelWorkItems([
      { ...base, id: "WI-1", priority: "high" },
      { ...base, id: "WI-2", priority: "medium" }
    ], { ...DEFAULT_SCHEDULER_POLICY, maxConcurrentWorkflows: 2 }, new Set());

    expect(selected.map((item) => item.id)).toEqual(["WI-1"]);
  });

  it("selects multiple active work items when cross-work-item parallelism is explicitly enabled", () => {
    const selected = selectParallelWorkItems([
      { ...base, id: "WI-1", priority: "high" },
      { ...base, id: "WI-2", priority: "medium" },
      { ...base, id: "WI-3", priority: "low" }
    ], { ...DEFAULT_SCHEDULER_POLICY, completeLoopBeforeNextWorkItem: false, maxConcurrentWorkflows: 2 }, new Set());

    expect(selected.map((item) => item.id)).toEqual(["WI-1", "WI-2"]);
  });

  it("does not start dependency-blocked work in parallel", () => {
    const selected = selectParallelWorkItems([
      { ...base, id: "WI-prereq", priority: "medium", state: "VERIFY" },
      { ...base, id: "WI-blocked", priority: "urgent", dependencies: ["WI-prereq"] },
      { ...base, id: "WI-free", priority: "high" }
    ], { ...DEFAULT_SCHEDULER_POLICY, completeLoopBeforeNextWorkItem: false, maxConcurrentWorkflows: 3 }, new Set());

    expect(selected.map((item) => item.id)).toEqual(["WI-free", "WI-prereq"]);
    expect(getBlockingWorkItemIds({ ...base, id: "WI-blocked", dependencies: ["WI-prereq"] }, [
      { ...base, id: "WI-prereq", state: "VERIFY" }
    ])).toEqual(["WI-prereq"]);
  });

  it("treats closed dependency work as satisfied", () => {
    const item = { ...base, id: "WI-dependent", dependencies: ["WI-done"] };
    expect(dependenciesSatisfied(item, [{ ...base, id: "WI-done", state: "CLOSED" }, item])).toBe(true);
  });
});

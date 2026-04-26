import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULER_POLICY, selectNextWorkItem, selectParallelWorkItems, shouldUseLiveApi, type WorkItem } from "../packages/shared/src";

const base: WorkItem = {
  id: "WI-1",
  title: "Base",
  requestType: "feature",
  priority: "medium",
  state: "NEW",
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

  it("selects multiple active work items when parallelism is safe", () => {
    const selected = selectParallelWorkItems([
      { ...base, id: "WI-1", priority: "high" },
      { ...base, id: "WI-2", priority: "medium" },
      { ...base, id: "WI-3", priority: "low" }
    ], { ...DEFAULT_SCHEDULER_POLICY, maxConcurrentWorkflows: 2 }, new Set());

    expect(selected.map((item) => item.id)).toEqual(["WI-1", "WI-2"]);
  });
});

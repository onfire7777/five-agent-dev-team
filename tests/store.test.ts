import { describe, expect, it } from "vitest";
import { MemoryStore } from "../apps/controller/src/store";

describe("controller store workflow claims", () => {
  it("prevents duplicate workflow claims for the same item", async () => {
    const store = new MemoryStore();

    await expect(store.claimWorkItemForWorkflow("WI-1")).resolves.toBe(true);
    await expect(store.claimWorkItemForWorkflow("WI-1")).resolves.toBe(false);
    await store.releaseWorkItemWorkflowClaim("WI-1");
    await expect(store.claimWorkItemForWorkflow("WI-1")).resolves.toBe(true);
  });

  it("stores stage events with increasing sequence numbers", async () => {
    const store = new MemoryStore();

    const first = await store.addEvent({
      workItemId: "WI-1",
      stage: "INTAKE",
      ownerAgent: "product-delivery-orchestrator",
      level: "info",
      type: "stage_started",
      message: "Intake started."
    });
    const second = await store.addEvent({
      workItemId: "WI-1",
      stage: "INTAKE",
      ownerAgent: "product-delivery-orchestrator",
      level: "info",
      type: "stage_completed",
      message: "Intake complete."
    });

    expect(second.sequence).toBe(first.sequence + 1);
    await expect(store.listEvents(first.sequence, 10)).resolves.toEqual([second]);
  });
});

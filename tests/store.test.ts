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
});

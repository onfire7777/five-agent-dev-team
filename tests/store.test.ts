import { describe, expect, it } from "vitest";
import { MemoryStore } from "../apps/controller/src/store";
import type { MemoryRecord } from "../packages/shared/src";

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

  it("scopes repo and global memory when listing memories for a work item", async () => {
    const store = new MemoryStore();
    const workItem = await store.createWorkItem({
      title: "Scoped repo work",
      requestType: "feature",
      priority: "medium",
      dependencies: [],
      acceptanceCriteria: [],
      riskLevel: "medium",
      frontendNeeded: true,
      backendNeeded: true,
      rndNeeded: false,
      projectId: "project-a",
      repo: "owner/repo-a"
    });
    const now = new Date().toISOString();
    const baseMemory = {
      kind: "architecture",
      title: "Memory",
      content: "content",
      tags: [],
      confidence: "high",
      importance: 5,
      permanence: "permanent",
      source: "test",
      createdAt: now,
      updatedAt: now
    } satisfies Omit<MemoryRecord, "id" | "scope" | "projectId" | "repo">;

    await store.addMemories([
      { ...baseMemory, id: "same-repo", scope: "repo", projectId: "project-a", repo: "owner/repo-a" },
      { ...baseMemory, id: "other-repo", scope: "repo", projectId: "project-b", repo: "owner/repo-b" },
      { ...baseMemory, id: "global", scope: "global" },
      { ...baseMemory, id: "same-work", scope: "work_item", workItemId: workItem.id }
    ]);

    const memories = await store.listMemories(workItem.id);
    expect(memories.map((memory) => memory.id).sort()).toEqual(["same-repo", "same-work"]);
  });
});

import { describe, expect, it } from "vitest";
import { MemoryStore } from "../apps/controller/src/store";
import { recoverAutonomousWorkflow, type TemporalWorkflowRecoveryResult } from "../apps/controller/src/temporal";
import { recoverWorkflow } from "../scripts/recover-workflow";
import { WorkItemSchema, type WorkItem } from "../packages/shared/src";

describe("workflow recovery", () => {
  it("releases the workflow claim and blocks a non-terminal work item", async () => {
    const store = new MemoryStore();
    await store.upsertProjectConnection({
      repoOwner: "owner",
      repoName: "repo",
      localPath: "C:/repos/repo",
      active: true
    });
    const workItem = await store.createWorkItem({
      title: "Stuck workflow",
      requestType: "bug",
      priority: "high",
      dependencies: [],
      acceptanceCriteria: [],
      riskLevel: "medium",
      frontendNeeded: false,
      backendNeeded: true,
      rndNeeded: false,
      projectId: "owner-repo",
      repo: "owner/repo"
    });
    await store.claimWorkItemForWorkflow(workItem.id);

    const result = await recoverWorkflow({
      store,
      workItemId: workItem.id,
      temporalRecover: temporalNotConfigured
    });

    expect(result).toMatchObject({
      workItemId: workItem.id,
      previousState: "NEW",
      currentState: "BLOCKED",
      claimReleased: true,
      stateChanged: true,
      temporal: { reason: "temporal_not_configured" }
    });
    await expect(store.listWorkflowClaims()).resolves.toEqual([]);
    await expect(store.getWorkItemWithArtifacts(workItem.id)).resolves.toMatchObject({
      workItem: { state: "BLOCKED" }
    });
    await expect(store.listEvents(0, 10)).resolves.toEqual([
      expect.objectContaining({
        workItemId: workItem.id,
        level: "warn",
        type: "system",
        message: expect.stringContaining("Workflow recovery completed")
      })
    ]);
  });

  it("releases claims without changing already-terminal work items", async () => {
    const store = new MemoryStore();
    await store.upsertProjectConnection({
      repoOwner: "owner",
      repoName: "repo",
      localPath: "C:/repos/repo",
      active: true
    });
    const workItem = await store.createWorkItem({
      title: "Already blocked",
      requestType: "bug",
      priority: "medium",
      dependencies: [],
      acceptanceCriteria: [],
      riskLevel: "medium",
      frontendNeeded: false,
      backendNeeded: true,
      rndNeeded: false,
      projectId: "owner-repo",
      repo: "owner/repo"
    });
    await store.updateWorkItemState(workItem.id, "BLOCKED");
    await store.claimWorkItemForWorkflow(workItem.id);

    const result = await recoverWorkflow({
      store,
      workItemId: workItem.id,
      temporalRecover: temporalNotFound
    });

    expect(result).toMatchObject({
      previousState: "BLOCKED",
      currentState: "BLOCKED",
      stateChanged: false,
      temporal: { reason: "not_found" }
    });
    await expect(store.listWorkflowClaims()).resolves.toEqual([]);
    await expect(store.getWorkItemWithArtifacts(workItem.id)).resolves.toMatchObject({
      workItem: { state: "BLOCKED" }
    });
  });

  it("passes cancel recovery results through the workflow recovery path", async () => {
    const store = new MemoryStore();
    await store.upsertProjectConnection({
      repoOwner: "owner",
      repoName: "repo",
      localPath: "C:/repos/repo",
      active: true
    });
    const workItem = await store.createWorkItem({
      title: "Cancel stuck workflow",
      requestType: "bug",
      priority: "medium",
      dependencies: [],
      acceptanceCriteria: [],
      riskLevel: "medium",
      frontendNeeded: false,
      backendNeeded: true,
      rndNeeded: false,
      projectId: "owner-repo",
      repo: "owner/repo"
    });
    await store.claimWorkItemForWorkflow(workItem.id);

    const result = await recoverWorkflow({
      store,
      workItemId: workItem.id,
      temporalRecover: temporalCancelled
    });

    expect(result).toMatchObject({
      workItemId: workItem.id,
      currentState: "BLOCKED",
      claimReleased: true,
      stateChanged: true,
      temporal: {
        workflowId: `wi-owner-repo-${workItem.id}`,
        attempted: true,
        recovered: true,
        action: "cancel",
        reason: "cancelled",
        message: "Temporal workflow was cancelled."
      }
    });
    await expect(store.listWorkflowClaims()).resolves.toEqual([]);
    await expect(store.getWorkItemWithArtifacts(workItem.id)).resolves.toMatchObject({
      workItem: { state: "BLOCKED" }
    });
  });

  it("allows local recovery to continue for legacy unscoped work items", async () => {
    const previousAddress = process.env.TEMPORAL_ADDRESS;
    delete process.env.TEMPORAL_ADDRESS;
    try {
      const workItem = WorkItemSchema.parse({
        id: "WI-LEGACY",
        title: "Legacy work",
        requestType: "bug",
        priority: "medium",
        state: "NEW",
        dependencies: [],
        acceptanceCriteria: [],
        riskLevel: "medium",
        frontendNeeded: false,
        backendNeeded: true,
        rndNeeded: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await expect(recoverAutonomousWorkflow(workItem)).resolves.toMatchObject({
        workflowId: "wi-unscoped-WI-LEGACY",
        attempted: false,
        recovered: false,
        reason: "temporal_not_configured"
      });
    } finally {
      if (previousAddress === undefined) delete process.env.TEMPORAL_ADDRESS;
      else process.env.TEMPORAL_ADDRESS = previousAddress;
    }
  });
});

async function temporalNotConfigured(workItem: WorkItem): Promise<TemporalWorkflowRecoveryResult> {
  return {
    workflowId: `wi-${workItem.projectId}-${workItem.id}`,
    attempted: false,
    recovered: false,
    action: "terminate",
    reason: "temporal_not_configured",
    message: "TEMPORAL_ADDRESS is not configured."
  };
}

async function temporalNotFound(workItem: WorkItem): Promise<TemporalWorkflowRecoveryResult> {
  return {
    workflowId: `wi-${workItem.projectId}-${workItem.id}`,
    attempted: true,
    recovered: false,
    action: "terminate",
    reason: "not_found",
    message: "Temporal workflow was not found."
  };
}

async function temporalCancelled(workItem: WorkItem): Promise<TemporalWorkflowRecoveryResult> {
  return {
    workflowId: `wi-${workItem.projectId}-${workItem.id}`,
    attempted: true,
    recovered: true,
    action: "cancel",
    reason: "cancelled",
    message: "Temporal workflow was cancelled."
  };
}

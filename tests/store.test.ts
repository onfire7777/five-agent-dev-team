import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  PostgresStore,
  type ControllerStore,
  type StrictProjectScope
} from "../apps/controller/src/store";
import {
  OpportunityScanRunSchema,
  StageArtifactSchema,
  type MemoryRecord,
  type StageArtifact
} from "../packages/shared/src";

async function seedScanScope(store: ControllerStore, repoName: string): Promise<StrictProjectScope> {
  await store.upsertProjectConnection({
    repoOwner: "owner",
    repoName,
    localPath: `C:/repos/${repoName}`,
    active: true
  });
  return { projectId: `owner-${repoName}`, repo: `owner/${repoName}` };
}

async function expectOpportunityScanRunsNewestFirst(store: ControllerStore, repoName = "repo-a") {
  const scope = await seedScanScope(store, repoName);

  const older = await store.upsertOpportunityScanRun(scope, {
    sources: ["repo_memory"],
    candidatesCreated: 1,
    summary: "Older scan found one candidate.",
    startedAt: "2026-05-01T00:00:00.000Z",
    completedAt: "2026-05-01T00:00:01.000Z"
  });
  const newer = await store.upsertOpportunityScanRun(scope, {
    sources: ["human_direction"],
    candidatesCreated: 0,
    summary: "Newer scan reused an existing candidate.",
    startedAt: "2026-05-01T01:00:00.000Z",
    completedAt: "2026-05-01T01:00:01.000Z"
  });
  const running = await store.upsertOpportunityScanRun(scope, {
    status: "running",
    sources: ["repo_memory"],
    summary: "Running scan is not complete yet.",
    startedAt: "2026-05-01T02:00:00.000Z"
  });
  const updatedOlder = await store.upsertOpportunityScanRun(scope, {
    id: older.id,
    summary: "Older scan summary updated."
  });

  expect(OpportunityScanRunSchema.parse(newer)).toMatchObject({
    projectId: scope.projectId,
    repo: scope.repo,
    status: "complete",
    sources: ["human_direction"],
    candidatesCreated: 0
  });
  expect(running.completedAt).toBeUndefined();
  expect(updatedOlder).toMatchObject({
    sources: ["repo_memory"],
    candidatesCreated: 1,
    startedAt: "2026-05-01T00:00:00.000Z",
    completedAt: "2026-05-01T00:00:01.000Z"
  });
  await expect(store.listOpportunityScanRuns(scope)).resolves.toEqual([running, newer, updatedOlder]);
}

describe("controller store workflow claims", () => {
  it("prevents duplicate workflow claims for the same item", async () => {
    const store = new MemoryStore();

    await expect(store.claimWorkItemForWorkflow("WI-1")).resolves.toBe(true);
    await expect(store.claimWorkItemForWorkflow("WI-1")).resolves.toBe(false);
    await store.releaseWorkItemWorkflowClaim("WI-1");
    await expect(store.claimWorkItemForWorkflow("WI-1")).resolves.toBe(true);
    await expect(store.listWorkflowClaims()).resolves.toEqual(["WI-1"]);
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

  it("keeps project connections isolated and allows one team per repo", async () => {
    const store = new MemoryStore();

    const first = await store.upsertProjectConnection({
      repoOwner: "owner",
      repoName: "repo-a",
      localPath: "C:/repos/a",
      active: true,
      ghAvailable: true,
      ghAuthed: true,
      githubConnected: true,
      remoteMatches: true,
      defaultBranchVerified: true,
      lastValidatedAt: new Date().toISOString()
    });
    const second = await store.upsertProjectConnection({
      repoOwner: "owner",
      repoName: "repo-b",
      localPath: "C:/repos/b",
      active: true
    });

    expect(first.projectId).toBe("owner-repo-a");
    expect(first.repo).toBe("owner/repo-a");
    expect(first.memoryNamespace).toBe("owner-repo-a");
    expect(first.ghAuthed).toBe(true);

    let projects = await store.listProjectConnections();
    expect(projects[0].id).toBe(second.id);
    expect(projects.filter((project) => project.active)).toHaveLength(2);

    await store.activateProjectConnection(first.id);
    projects = await store.listProjectConnections();
    expect(projects[0].id).toBe(first.id);
    expect(projects[0].active).toBe(true);
    expect(projects.find((project) => project.id === second.id)?.active).toBe(true);
    await expect(store.activateProjectConnection("missing")).rejects.toThrow(/not found/);
  });

  it("attaches work items to the selected connected repo", async () => {
    const store = new MemoryStore();
    await store.upsertProjectConnection({
      repoOwner: "owner",
      repoName: "repo-a",
      localPath: "C:/repos/a",
      active: true
    });
    await store.upsertProjectConnection({
      repoOwner: "owner",
      repoName: "repo-b",
      localPath: "C:/repos/b",
      active: false
    });

    const workItem = await store.createWorkItem({
      title: "Repo B work",
      requestType: "feature",
      priority: "medium",
      dependencies: [],
      acceptanceCriteria: ["B only"],
      riskLevel: "medium",
      frontendNeeded: true,
      backendNeeded: true,
      rndNeeded: true,
      projectId: "owner-repo-b",
      repo: "owner/repo-b"
    });

    expect(workItem.projectId).toBe("owner-repo-b");
    expect(workItem.repo).toBe("owner/repo-b");
    expect(workItem.acceptanceCriteria).toEqual(["B only"]);
    await expect(
      store.createWorkItem({
        title: "Unknown repo",
        requestType: "feature",
        priority: "medium",
        dependencies: [],
        acceptanceCriteria: [],
        riskLevel: "medium",
        frontendNeeded: true,
        backendNeeded: true,
        rndNeeded: true,
        projectId: "missing"
      })
    ).rejects.toThrow(/Connected project was not found/);
  });

  it("persists schema-conformant opportunity scan runs newest-first", async () => {
    const store = new MemoryStore();
    await expectOpportunityScanRunsNewestFirst(store);
  });

  it.skipIf(!process.env.POSTGRES_TEST_DATABASE_URL)(
    "persists schema-conformant opportunity scan runs newest-first in Postgres",
    async () => {
      const connectionString = process.env.POSTGRES_TEST_DATABASE_URL;
      if (!connectionString) throw new Error("POSTGRES_TEST_DATABASE_URL is required for this test.");
      const store = new PostgresStore(connectionString);
      try {
        await store.init();
        await expectOpportunityScanRunsNewestFirst(store, `repo-scan-runs-${process.pid}-${Date.now()}`);
      } finally {
        await store.close();
      }
    }
  );

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

  it("retrieves work item artifacts by work item and artifact id", async () => {
    const store = new MemoryStore();
    const workItem = await store.createWorkItem({
      title: "Artifact lookup",
      requestType: "feature",
      priority: "medium",
      dependencies: [],
      acceptanceCriteria: [],
      riskLevel: "medium",
      frontendNeeded: true,
      backendNeeded: false,
      rndNeeded: false,
      projectId: "project-a",
      repo: "owner/repo-a"
    });
    const artifact = StageArtifactSchema.parse({
      artifactId: "artifact-lookup-1",
      artifactKind: "BackendImplSummary",
      workItemId: workItem.id,
      projectId: "project-a",
      repo: "owner/repo-a",
      stage: "BACKEND_BUILD",
      ownerAgent: "backend-systems-engineering",
      status: "passed",
      title: "Backend implementation summary",
      summary: "Lookup endpoints implemented.",
      nextStage: "VERIFY",
      bodyJson: {
        workItemId: workItem.id,
        projectId: "project-a",
        apiChanges: ["GET /api/work-items/:id", "GET /api/artifacts/:id"]
      },
      createdAt: new Date().toISOString()
    });

    await store.addArtifact(artifact);

    await expect(store.getArtifact("artifact-lookup-1")).resolves.toMatchObject({
      artifactId: "artifact-lookup-1",
      workItemId: workItem.id
    });
    await expect(store.getWorkItemWithArtifacts(workItem.id)).resolves.toMatchObject({
      workItem: { id: workItem.id },
      artifacts: [{ artifactId: "artifact-lookup-1" }]
    });
  });

  it("deactivates connected projects without deleting historical work", async () => {
    const store = new MemoryStore();
    const project = await store.upsertProjectConnection({
      repoOwner: "owner",
      repoName: "repo-a",
      localPath: "C:/repos/a",
      active: true
    });

    const deactivated = await store.deactivateProjectConnection(project.id);

    expect(deactivated.active).toBe(false);
    expect((await store.listProjectConnections()).find((item) => item.id === project.id)?.active).toBe(false);
    await expect(store.deactivateProjectConnection("missing")).rejects.toThrow(/not found/);
  });

  it("makes the latest closed loop memory available to the next work item in the same repo", async () => {
    const store = new MemoryStore();
    const first = await store.createWorkItem({
      title: "First loop",
      requestType: "feature",
      priority: "medium",
      dependencies: [],
      acceptanceCriteria: [],
      riskLevel: "medium",
      frontendNeeded: true,
      backendNeeded: true,
      rndNeeded: true,
      projectId: "project-a",
      repo: "owner/repo-a"
    });
    const now = new Date().toISOString();
    const closure: StageArtifact = {
      artifactId: "loop-closure-first",
      artifactKind: "LoopClosureSummary",
      workItemId: first.id,
      projectId: "project-a",
      repo: "owner/repo-a",
      stage: "CLOSED",
      ownerAgent: "product-delivery-orchestrator",
      status: "passed",
      title: "Loop closure summary",
      summary: "Loop complete and cleanly synced.",
      decisions: ["Persist this closure as the repo latest-loop memory."],
      risks: [],
      filesChanged: [],
      testsRun: ["git-sync:passed"],
      releaseReadiness: "ready",
      nextStage: null,
      promptHash: "test-prompt",
      skillIds: ["handoff-discipline"],
      capabilityIds: [],
      bodyJson: {
        loopRunId: "test-loop",
        workItemId: first.id,
        projectId: "project-a",
        repo: "owner/repo-a",
        status: "closed"
      },
      createdAt: now
    };
    await store.addArtifact(closure);
    const second = await store.createWorkItem({
      title: "Second loop",
      requestType: "feature",
      priority: "medium",
      dependencies: [],
      acceptanceCriteria: [],
      riskLevel: "medium",
      frontendNeeded: true,
      backendNeeded: true,
      rndNeeded: true,
      projectId: "project-a",
      repo: "owner/repo-a"
    });

    const memories = await store.listMemories(second.id);
    expect(
      memories.some((memory) => memory.tags.includes("latest-loop") && memory.content.includes("Loop complete"))
    ).toBe(true);
  });
});

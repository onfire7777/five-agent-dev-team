import { DEFAULT_SCHEDULER_POLICY, selectParallelWorkItems, type SchedulerPolicy } from "../../../packages/shared/src";
import type { ControllerStore } from "./store";
import { startAutonomousWorkflow } from "./temporal";

export function createSchedulerPolicy(): SchedulerPolicy {
  return {
    ...DEFAULT_SCHEDULER_POLICY,
    mode: (process.env.AGENT_EXECUTION_MODE as any) || DEFAULT_SCHEDULER_POLICY.mode,
    continuous: process.env.SCHEDULER_ENABLED !== "false",
    pollIntervalSeconds: Number(process.env.SCHEDULER_POLL_SECONDS || DEFAULT_SCHEDULER_POLICY.pollIntervalSeconds),
    maxConcurrentWorkflows: Number(
      process.env.MAX_CONCURRENT_WORKFLOWS || DEFAULT_SCHEDULER_POLICY.maxConcurrentWorkflows
    ),
    maxConcurrentAgentRuns: Number(
      process.env.MAX_CONCURRENT_AGENT_RUNS || DEFAULT_SCHEDULER_POLICY.maxConcurrentAgentRuns
    ),
    maxConcurrentRepoWrites: Number(
      process.env.MAX_CONCURRENT_REPO_WRITES || DEFAULT_SCHEDULER_POLICY.maxConcurrentRepoWrites
    ),
    completeLoopBeforeNextWorkItem:
      process.env.COMPLETE_LOOP_BEFORE_NEXT_WORK_ITEM === undefined
        ? DEFAULT_SCHEDULER_POLICY.completeLoopBeforeNextWorkItem
        : /^(1|true|yes)$/i.test(process.env.COMPLETE_LOOP_BEFORE_NEXT_WORK_ITEM),
    allowParallelWorkItemsWhenDisjoint:
      process.env.ALLOW_PARALLEL_DISJOINT_PROJECTS === undefined
        ? DEFAULT_SCHEDULER_POLICY.allowParallelWorkItemsWhenDisjoint
        : /^(1|true|yes)$/i.test(process.env.ALLOW_PARALLEL_DISJOINT_PROJECTS)
  };
}

export function startSmartScheduler(store: ControllerStore): NodeJS.Timeout | null {
  const policy = createSchedulerPolicy();
  if (!policy.continuous) return null;
  if (!process.env.TEMPORAL_ADDRESS) {
    console.log("Smart scheduler idle: TEMPORAL_ADDRESS is not configured.");
    return null;
  }

  const activeIds = new Set<string>();

  const tick = async () => {
    const status = await store.getStatus();
    if (status.system.emergencyStop) return;

    const activeClaims = await store.listWorkflowClaims();
    const durableActiveIds = new Set([...activeIds, ...activeClaims]);
    const activeWork = status.workItems.filter((item) => !["NEW", "CLOSED", "BLOCKED"].includes(item.state));
    const claimedWork = status.workItems.filter((item) => durableActiveIds.has(item.id));
    const activeIdsForCapacity = new Set([...durableActiveIds, ...activeWork.map((item) => item.id)]);
    const activeScopeItems = [...activeWork, ...claimedWork];
    if (
      policy.completeLoopBeforeNextWorkItem &&
      !policy.allowParallelWorkItemsWhenDisjoint &&
      (activeIdsForCapacity.size > 0 || activeScopeItems.length > 0)
    ) {
      return;
    }

    const queuedItems = status.workItems.filter((item) => item.state === "NEW");
    const nextItems = selectParallelWorkItems(queuedItems, policy, activeIdsForCapacity, activeScopeItems);
    await Promise.all(
      nextItems.map(async (next) => {
        const claimed = await store.claimWorkItemForWorkflow(next.id);
        if (!claimed) return;
        activeIds.add(next.id);
        let workflowStarted = false;
        try {
          const workflowId = await startAutonomousWorkflow(next);
          if (workflowId) {
            workflowStarted = true;
            await store.updateWorkItemState(next.id, "INTAKE");
          } else {
            await store.releaseWorkItemWorkflowClaim(next.id);
          }
        } catch (error) {
          if (!workflowStarted) await store.releaseWorkItemWorkflowClaim(next.id);
          throw error;
        } finally {
          activeIds.delete(next.id);
        }
      })
    );
  };

  const timer = setInterval(() => {
    tick().catch((error) => {
      console.warn("Smart scheduler tick failed:", error instanceof Error ? error.message : error);
    });
  }, policy.pollIntervalSeconds * 1000);

  tick().catch(() => undefined);
  return timer;
}

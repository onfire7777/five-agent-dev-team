import { DEFAULT_SCHEDULER_POLICY, selectParallelWorkItems, type SchedulerPolicy } from "../../../packages/shared/src";
import type { ControllerStore } from "./store";
import { startAutonomousWorkflow } from "./temporal";

export function createSchedulerPolicy(): SchedulerPolicy {
  return {
    ...DEFAULT_SCHEDULER_POLICY,
    mode: (process.env.AGENT_EXECUTION_MODE as any) || DEFAULT_SCHEDULER_POLICY.mode,
    continuous: process.env.SCHEDULER_ENABLED !== "false",
    pollIntervalSeconds: Number(process.env.SCHEDULER_POLL_SECONDS || DEFAULT_SCHEDULER_POLICY.pollIntervalSeconds),
    maxConcurrentWorkflows: Number(process.env.MAX_CONCURRENT_WORKFLOWS || DEFAULT_SCHEDULER_POLICY.maxConcurrentWorkflows),
    maxConcurrentAgentRuns: Number(process.env.MAX_CONCURRENT_AGENT_RUNS || DEFAULT_SCHEDULER_POLICY.maxConcurrentAgentRuns),
    maxConcurrentRepoWrites: Number(process.env.MAX_CONCURRENT_REPO_WRITES || DEFAULT_SCHEDULER_POLICY.maxConcurrentRepoWrites),
    completeLoopBeforeNextWorkItem: process.env.COMPLETE_LOOP_BEFORE_NEXT_WORK_ITEM === undefined
      ? DEFAULT_SCHEDULER_POLICY.completeLoopBeforeNextWorkItem
      : /^(1|true|yes)$/i.test(process.env.COMPLETE_LOOP_BEFORE_NEXT_WORK_ITEM)
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
    const activeWork = status.workItems.filter((item) => !["NEW", "CLOSED", "BLOCKED"].includes(item.state));
    if (policy.completeLoopBeforeNextWorkItem && (activeIds.size > 0 || activeClaims.length > 0 || activeWork.length > 0)) {
      return;
    }

    const queuedItems = status.workItems.filter((item) => item.state === "NEW");
    const nextItems = selectParallelWorkItems(queuedItems, policy, activeIds);
    await Promise.all(nextItems.map(async (next) => {
      const claimed = await store.claimWorkItemForWorkflow(next.id);
      if (!claimed) return;
      activeIds.add(next.id);
      try {
        const workflowId = await startAutonomousWorkflow(next);
        if (workflowId) {
          await store.updateWorkItemState(next.id, "INTAKE");
        } else {
          await store.releaseWorkItemWorkflowClaim(next.id);
        }
      } catch (error) {
        await store.releaseWorkItemWorkflowClaim(next.id);
        throw error;
      } finally {
        activeIds.delete(next.id);
      }
    }));
  };

  const timer = setInterval(() => {
    tick().catch((error) => {
      console.warn("Smart scheduler tick failed:", error instanceof Error ? error.message : error);
    });
  }, policy.pollIntervalSeconds * 1000);

  tick().catch(() => undefined);
  return timer;
}

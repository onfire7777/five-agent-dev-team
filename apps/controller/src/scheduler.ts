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
    maxConcurrentRepoWrites: Number(process.env.MAX_CONCURRENT_REPO_WRITES || DEFAULT_SCHEDULER_POLICY.maxConcurrentRepoWrites)
  };
}

export function startSmartScheduler(store: ControllerStore): NodeJS.Timeout | null {
  const policy = createSchedulerPolicy();
  if (!policy.continuous) return null;

  const activeIds = new Set<string>();

  const tick = async () => {
    const status = await store.getStatus();
    if (status.system.emergencyStop) return;

    const nextItems = selectParallelWorkItems(status.workItems, policy, activeIds);
    await Promise.all(nextItems.map(async (next) => {
      activeIds.add(next.id);
      try {
        await startAutonomousWorkflow(next);
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

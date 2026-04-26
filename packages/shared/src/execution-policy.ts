import { z } from "zod";
import type { WorkItem } from "./schemas";

export const AgentExecutionModeSchema = z.enum(["chatgpt_pro_assisted", "api_live", "dry_run"]);
export type AgentExecutionMode = z.infer<typeof AgentExecutionModeSchema>;

export const SchedulerPolicySchema = z.object({
  mode: AgentExecutionModeSchema.default("chatgpt_pro_assisted"),
  continuous: z.boolean().default(true),
  pollIntervalSeconds: z.number().int().positive().default(15),
  maxConcurrentWorkflows: z.number().int().positive().default(3),
  maxConcurrentAgentRuns: z.number().int().positive().default(5),
  maxConcurrentRepoWrites: z.number().int().positive().default(1),
  completeLoopBeforeNextWorkItem: z.boolean().default(true),
  cooldownSecondsAfterFailure: z.number().int().positive().default(300),
  preferCodexForCodingWork: z.boolean().default(true),
  requireEventTrigger: z.boolean().default(true),
  parallelDiscovery: z.boolean().default(true),
  parallelFrontendBackend: z.boolean().default(true),
  parallelVerificationPlanning: z.boolean().default(true),
  allowParallelWorkItemsWhenDisjoint: z.boolean().default(true)
});

export type SchedulerPolicy = z.infer<typeof SchedulerPolicySchema>;

export const DEFAULT_SCHEDULER_POLICY: SchedulerPolicy = {
  mode: "chatgpt_pro_assisted",
  continuous: true,
  pollIntervalSeconds: 15,
  maxConcurrentWorkflows: 3,
  maxConcurrentAgentRuns: 5,
  maxConcurrentRepoWrites: 1,
  completeLoopBeforeNextWorkItem: true,
  cooldownSecondsAfterFailure: 300,
  preferCodexForCodingWork: true,
  requireEventTrigger: true,
  parallelDiscovery: true,
  parallelFrontendBackend: true,
  parallelVerificationPlanning: true,
  allowParallelWorkItemsWhenDisjoint: true
};

export function getPriorityScore(workItem: WorkItem): number {
  const priority = { urgent: 100, high: 75, medium: 45, low: 20 }[workItem.priority];
  const riskDrag = { high: -10, medium: 0, low: 5 }[workItem.riskLevel];
  const blockedBoost = workItem.state === "BLOCKED" ? -100 : 0;
  return priority + riskDrag + blockedBoost;
}

export function selectNextWorkItem(workItems: WorkItem[], policy: SchedulerPolicy): WorkItem | null {
  if (!policy.continuous) return null;
  const candidates = workItems.filter((item) =>
    !["CLOSED", "BLOCKED"].includes(item.state) && getBlockingWorkItemIds(item, workItems).length === 0
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => getPriorityScore(b) - getPriorityScore(a))[0] ?? null;
}

export function selectParallelWorkItems(workItems: WorkItem[], policy: SchedulerPolicy, activeIds: Set<string>, activeWorkItems: WorkItem[] = []): WorkItem[] {
  if (!policy.continuous) return [];
  const capacity = Math.max(0, policy.maxConcurrentWorkflows - activeIds.size);
  if (capacity === 0) return [];
  const sliceCount = policy.completeLoopBeforeNextWorkItem ? 1 : policy.allowParallelWorkItemsWhenDisjoint ? capacity : 1;
  const activeScopes = new Set(activeWorkItems.map(projectScopeKey).filter(Boolean));
  const selectedScopes = new Set<string>();
  const candidates = workItems
    .filter((item) => !activeIds.has(item.id))
    .filter((item) => !["CLOSED", "BLOCKED"].includes(item.state))
    .filter((item) => getBlockingWorkItemIds(item, workItems).length === 0)
    .sort((a, b) => getPriorityScore(b) - getPriorityScore(a));
  const selected: WorkItem[] = [];
  for (const item of candidates) {
    const scope = projectScopeKey(item);
    if (scope && (activeScopes.has(scope) || selectedScopes.has(scope))) continue;
    selected.push(item);
    if (scope) selectedScopes.add(scope);
    if (selected.length >= sliceCount) break;
  }
  return selected;
}

export function getBlockingWorkItemIds(workItem: WorkItem, allWorkItems: WorkItem[]): string[] {
  const dependencies = workItem.dependencies || [];
  if (dependencies.length === 0) return [];
  const byId = new Map(allWorkItems.map((item) => [item.id, item]));
  return dependencies.filter((dependencyId) => byId.get(dependencyId)?.state !== "CLOSED");
}

export function dependenciesSatisfied(workItem: WorkItem, allWorkItems: WorkItem[]): boolean {
  return getBlockingWorkItemIds(workItem, allWorkItems).length === 0;
}

export function getSafeParallelStages(workItem: WorkItem): string[] {
  const stages = ["INTAKE"];
  if (workItem.rndNeeded) stages.push("RND");
  if (workItem.frontendNeeded && workItem.backendNeeded) {
    stages.push("FRONTEND_BUILD+BACKEND_BUILD");
  } else if (workItem.frontendNeeded) {
    stages.push("FRONTEND_BUILD");
  } else if (workItem.backendNeeded) {
    stages.push("BACKEND_BUILD");
  }
  stages.push("VERIFY_PREP", "RELEASE_GATE");
  return stages;
}

export function shouldUseLiveApi(policy: SchedulerPolicy): boolean {
  return policy.mode === "api_live";
}

function projectScopeKey(workItem: WorkItem): string {
  return workItem.projectId || workItem.repo || "";
}

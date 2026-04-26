import type { WorkItemState } from "./schemas";

export const WORKFLOW_SEQUENCE: WorkItemState[] = [
  "NEW",
  "INTAKE",
  "RND",
  "CONTRACT",
  "FRONTEND_BUILD",
  "BACKEND_BUILD",
  "INTEGRATION",
  "VERIFY",
  "RELEASE",
  "CLOSED"
];

export const ALL_WORK_ITEM_STATES: WorkItemState[] = [
  ...WORKFLOW_SEQUENCE,
  "BLOCKED"
];

const transitions: Record<WorkItemState, WorkItemState[]> = {
  NEW: ["INTAKE", "BLOCKED"],
  INTAKE: ["RND", "CONTRACT", "VERIFY", "BLOCKED"],
  RND: ["CONTRACT", "BLOCKED"],
  CONTRACT: ["FRONTEND_BUILD", "BACKEND_BUILD", "INTEGRATION", "BLOCKED"],
  FRONTEND_BUILD: ["BACKEND_BUILD", "INTEGRATION", "VERIFY", "BLOCKED"],
  BACKEND_BUILD: ["FRONTEND_BUILD", "INTEGRATION", "VERIFY", "BLOCKED"],
  INTEGRATION: ["VERIFY", "FRONTEND_BUILD", "BACKEND_BUILD", "BLOCKED"],
  VERIFY: ["RELEASE", "FRONTEND_BUILD", "BACKEND_BUILD", "RND", "BLOCKED"],
  RELEASE: ["CLOSED", "VERIFY", "BLOCKED"],
  CLOSED: [],
  BLOCKED: ["INTAKE", "RND", "CONTRACT", "FRONTEND_BUILD", "BACKEND_BUILD", "VERIFY", "RELEASE"]
};

export function canTransition(from: WorkItemState, to: WorkItemState): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function nextStates(from: WorkItemState): WorkItemState[] {
  return [...(transitions[from] ?? [])];
}

export function assertTransition(from: WorkItemState, to: WorkItemState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid work-item transition from ${from} to ${to}`);
  }
}

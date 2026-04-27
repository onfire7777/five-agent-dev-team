export interface GitSyncInput {
  cleanWorktree: boolean;
  ahead: number;
  behind: number;
  duplicateAutomationBranches: number;
}

export interface GitSyncResult {
  synced: boolean;
  reasons: string[];
}

export function evaluateGitSync(input: GitSyncInput): GitSyncResult {
  const reasons: string[] = [];
  if (!input.cleanWorktree) reasons.push("worktree has uncommitted changes");
  if (input.ahead !== 0) reasons.push(`local branch is ${input.ahead} commit(s) ahead`);
  if (input.behind !== 0) reasons.push(`local branch is ${input.behind} commit(s) behind`);
  if (input.duplicateAutomationBranches > 0) {
    reasons.push(`${input.duplicateAutomationBranches} duplicate automation branch(es) detected`);
  }
  return { synced: reasons.length === 0, reasons };
}

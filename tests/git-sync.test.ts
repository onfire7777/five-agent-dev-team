import { describe, expect, it } from "vitest";
import { evaluateGitSync } from "../packages/shared/src";

describe("local/remote sync", () => {
  it("passes when local and remote are clean and aligned", () => {
    expect(
      evaluateGitSync({
        cleanWorktree: true,
        ahead: 0,
        behind: 0,
        duplicateAutomationBranches: 0
      })
    ).toEqual({ synced: true, reasons: [] });
  });

  it("reports every sync blocker", () => {
    const result = evaluateGitSync({
      cleanWorktree: false,
      ahead: 1,
      behind: 2,
      duplicateAutomationBranches: 1
    });

    expect(result.synced).toBe(false);
    expect(result.reasons).toHaveLength(4);
  });
});

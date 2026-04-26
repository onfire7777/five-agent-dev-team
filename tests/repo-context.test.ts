import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSharedContext,
  createSampleWorkItems,
  loadRepoContextMemories,
  type TargetRepoConfig
} from "../packages/shared/src";

function configFor(repoPath: string): TargetRepoConfig {
  return {
    repo: {
      owner: "test",
      name: "repo",
      defaultBranch: "main",
      localPath: repoPath
    },
    commands: {
      install: "npm ci",
      lint: "npm run lint",
      typecheck: "npm run typecheck",
      test: "npm test",
      build: "npm run build",
      security: "npm audit --audit-level=high",
      release: "gh workflow run release.yml --ref main"
    },
    context: {
      includeDefaultContextDir: true,
      defaultContextDir: ".agent-team/context",
      maxFiles: 8,
      maxBytesPerFile: 12_000,
      files: []
    },
    release: {
      mode: "autonomous",
      githubActionsRequired: true,
      requireLocalRemoteSync: true,
      requireCleanWorktree: true,
      allowedRisk: {
        low: "autonomous",
        medium: "autonomous_with_all_gates",
        high: "autonomous_with_all_gates"
      },
      emergencyStopFile: ".agent-team/emergency-stop"
    },
    scheduler: {
      mode: "chatgpt_pro_assisted",
      continuous: true,
      pollIntervalSeconds: 60,
      maxConcurrentWorkflows: 3,
      maxConcurrentAgentRuns: 5,
      maxConcurrentRepoWrites: 1,
      cooldownSecondsAfterFailure: 300,
      preferCodexForCodingWork: true,
      requireEventTrigger: true,
      parallelDiscovery: true,
      parallelFrontendBackend: true,
      parallelVerificationPlanning: true,
      allowParallelWorkItemsWhenDisjoint: true
    }
  };
}

describe("repo context packs", () => {
  it("loads default .agent-team context files as permanent repo memory", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "agent-team-context-"));
    const contextDir = path.join(repoPath, ".agent-team", "context");
    await fs.mkdir(contextDir, { recursive: true });
    await fs.writeFile(path.join(contextDir, "TEAM_RULES.md"), "Use the configured test command before release.");

    const workItem = createSampleWorkItems()[0];
    const memories = await loadRepoContextMemories(configFor(repoPath), workItem);
    const shared = buildSharedContext(workItem, [], memories);

    expect(memories).toHaveLength(1);
    expect(memories[0].permanence).toBe("permanent");
    expect(shared.contextNotes[0]).toContain("configured test command");
  });

  it("rejects required context files outside the target repo", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "agent-team-context-"));
    const config = {
      ...configFor(repoPath),
      context: {
        ...configFor(repoPath).context,
        files: [{ path: "../outside.md", required: true, maxBytes: 12_000 }]
      }
    };

    await expect(loadRepoContextMemories(config, createSampleWorkItems()[0])).rejects.toThrow(/inside repo root/);
  });
});

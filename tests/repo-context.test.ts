import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSharedContext,
  createSampleWorkItems,
  loadRepoContextMemories,
  selectRelevantMemories,
  type TargetRepoConfig
} from "../packages/shared/src";

function configFor(repoPath: string): TargetRepoConfig {
  return {
    project: {
      id: "test-repo",
      isolation: {
        requireExplicitRepoConnection: true,
        allowCrossProjectMemory: false,
        allowGlobalMemory: false
      }
    },
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
    integrations: {
      electron: {
        enabled: false,
        preferredAutomation: "playwright_test",
        artifactsDir: ".agent-team/artifacts/electron",
        requireIsolatedProfile: true,
        allowRemoteDebugging: false,
        notes: []
      },
      mcpServers: [],
      capabilityPacks: []
    },
    models: {
      primaryCodingModel: "gpt-5.5",
      researchModel: "gpt-5.5",
      reviewModel: "gpt-5.5",
      fallbackModel: "gpt-5.4",
      useBestAvailable: true
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
      completeLoopBeforeNextWorkItem: true,
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
    expect(memories[0].projectId).toBe("test-repo");
    expect(memories[0].repo).toBe("test/repo");
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

  it("adds optional Electron and MCP integration context without executing tools", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "agent-team-context-"));
    const config: TargetRepoConfig = {
      ...configFor(repoPath),
      integrations: {
        electron: {
          enabled: true,
          preferredAutomation: "playwright_test",
          appPath: "apps/desktop",
          testCommand: "npm run test:electron",
          debugPort: 9222,
          artifactsDir: ".agent-team/artifacts/electron",
          requireIsolatedProfile: true,
          allowRemoteDebugging: true,
          notes: ["Use Playwright _electron for CI and MCP only for local investigation."]
        },
        mcpServers: [
          {
            name: "electron-debug",
            category: "electron",
            description: "Dev-only Electron CDP bridge",
            enabled: true,
            transport: "stdio",
            command: "npx",
            args: ["-y", "electron-debug-mcp"],
            activation: {
              mode: "on_demand",
              stages: ["VERIFY"],
              agents: [],
              keywords: ["electron"]
            },
            env: {},
            timeoutSeconds: 30,
            cacheToolsList: true,
            toolAllowlist: ["list", "evaluate"],
            notes: ["Dev-only Electron CDP bridge."]
          }
        ],
        capabilityPacks: [
          {
            name: "Electron testing knowledge",
            kind: "knowledge",
            enabled: true,
            summary: "Prefer Playwright _electron tests for repeatable CI coverage.",
            activation: {
              mode: "on_demand",
              stages: [],
              agents: ["quality-security-privacy-release"],
              keywords: ["electron"]
            },
            contextFiles: [],
            notes: ["Convert useful MCP exploration into checked-in tests."]
          }
        ]
      }
    };

    const workItem = createSampleWorkItems()[0];
    const shared = buildSharedContext(workItem, [], [], {
      targetRepoConfig: config,
      stage: "VERIFY",
      agent: "quality-security-privacy-release"
    });

    expect(shared.toolIntegrations).toHaveLength(3);
    expect(shared.toolIntegrations[0].summary).toContain("testCommand=npm run test:electron");
    expect(shared.toolIntegrations[1].notes.join(" ")).toContain("allowedTools=list,evaluate");
    expect(shared.toolIntegrations[1].enabled).toBe(true);
    expect(shared.contextNotes.join(" ")).toContain("Prefer Playwright _electron");
  });

  it("keeps configured MCP servers inactive until their activation rules match", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "agent-team-context-"));
    const config: TargetRepoConfig = {
      ...configFor(repoPath),
      integrations: {
        ...configFor(repoPath).integrations,
        mcpServers: [
          {
            name: "browser-e2e",
            category: "browser",
            description: "Playwright MCP for UI verification",
            enabled: true,
            transport: "stdio",
            command: "npx",
            args: ["-y", "@playwright/mcp@latest", "--isolated"],
            activation: {
              mode: "on_demand",
              stages: ["VERIFY"],
              agents: ["quality-security-privacy-release"],
              keywords: ["browser", "ui", "accessibility"]
            },
            env: {},
            timeoutSeconds: 30,
            cacheToolsList: true,
            toolAllowlist: ["browser_snapshot", "browser_click"],
            notes: []
          }
        ],
        capabilityPacks: []
      }
    };

    const shared = buildSharedContext(createSampleWorkItems()[0], [], [], {
      targetRepoConfig: config,
      stage: "RND",
      agent: "rnd-architecture-innovation"
    });

    expect(shared.toolIntegrations[0].enabled).toBe(false);
  });

  it("does not mix permanent repo memory across project scopes", () => {
    const workItem = {
      ...createSampleWorkItems()[0],
      projectId: "project-a",
      repo: "owner/a"
    };
    const now = new Date().toISOString();
    const selected = selectRelevantMemories([
      {
        id: "same-project",
        scope: "repo",
        projectId: "project-a",
        repo: "owner/a",
        kind: "preference",
        title: "Same project",
        content: "Use npm ci.",
        tags: ["repo"],
        confidence: "high",
        importance: 5,
        permanence: "permanent",
        source: "test",
        createdAt: now,
        updatedAt: now
      },
      {
        id: "other-project",
        scope: "repo",
        projectId: "project-b",
        repo: "owner/b",
        kind: "preference",
        title: "Other project",
        content: "Use pnpm.",
        tags: ["repo"],
        confidence: "high",
        importance: 5,
        permanence: "permanent",
        source: "test",
        createdAt: now,
        updatedAt: now
      },
      {
        id: "global",
        scope: "global",
        kind: "preference",
        title: "Global",
        content: "Do not leak across projects.",
        tags: ["repo"],
        confidence: "high",
        importance: 5,
        permanence: "permanent",
        source: "test",
        createdAt: now,
        updatedAt: now
      }
    ], workItem);

    expect(selected.map((memory) => memory.id)).toEqual(["same-project"]);
  });
});

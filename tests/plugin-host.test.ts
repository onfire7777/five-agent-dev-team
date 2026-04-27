import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  disposePlugins,
  initializePlugins,
  mergePluginContributions,
  parseLifecycleCommand
} from "../packages/agents/src";
import { type AgentTeamPlugin, TargetRepoConfigSchema, type TargetRepoConfig } from "../packages/shared/src";

function configWithPlugins(plugins: AgentTeamPlugin[], localPath = process.cwd()): TargetRepoConfig {
  return TargetRepoConfigSchema.parse({
    project: {
      id: "project-a",
      isolation: {
        requireExplicitRepoConnection: true,
        allowCrossProjectMemory: false,
        allowGlobalMemory: false
      }
    },
    repo: {
      owner: "acme",
      name: "app",
      defaultBranch: "main",
      localPath
    },
    commands: {
      install: "npm ci",
      lint: "npm run lint",
      typecheck: "npm run typecheck",
      test: "npm test",
      build: "npm run build",
      security: "npm audit --audit-level=high",
      release: 'gh release create "$AGENT_RELEASE_TAG" --notes-file release/notes.md --verify-tag'
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
      capabilityPacks: [],
      plugins
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
  });
}

const contributionPlugin: AgentTeamPlugin = {
  name: "Browser Use",
  packageName: "@agent-team/browser-use",
  enabled: true,
  allowlisted: true,
  projectId: "project-a",
  repo: "acme/app",
  contributions: {
    capabilities: [
      {
        name: "Browser smoke testing",
        kind: "plugin",
        enabled: true,
        summary: "Use an isolated browser session for UI verification.",
        activation: {
          mode: "on_demand",
          stages: ["VERIFY"],
          agents: [],
          keywords: ["browser"]
        },
        contextFiles: [],
        notes: ["Persist useful browser checks as Playwright tests."]
      }
    ],
    mcpServers: [
      {
        name: "browser-use",
        category: "browser",
        enabled: true,
        transport: "stdio",
        command: "browser-use",
        args: [],
        activation: {
          mode: "on_demand",
          stages: ["VERIFY"],
          agents: [],
          keywords: ["browser"]
        },
        env: {},
        timeoutSeconds: 30,
        cacheToolsList: true,
        toolAllowlist: ["navigate", "screenshot"],
        notes: []
      }
    ],
    skills: [],
    tools: [],
    releaseGates: []
  }
};

describe("plugin host", () => {
  it("does not initialize disabled plugins", async () => {
    const config = configWithPlugins([
      {
        ...contributionPlugin,
        enabled: false,
        allowlisted: false
      }
    ]);

    await expect(initializePlugins(config)).resolves.toEqual([]);
  });

  it("requires enabled plugins to be allowlisted", async () => {
    const config = configWithPlugins([
      {
        ...contributionPlugin,
        allowlisted: false
      }
    ]);

    await expect(initializePlugins(config)).rejects.toThrow(/not allowlisted/);
  });

  it("merges allowlisted plugin contributions into runtime integrations", async () => {
    const config = configWithPlugins([contributionPlugin]);
    const loaded = await initializePlugins(config);
    const merged = mergePluginContributions(config, loaded);

    expect(loaded).toHaveLength(1);
    expect(merged.integrations.capabilityPacks[0].name).toBe("Browser smoke testing");
    expect(merged.integrations.mcpServers[0].name).toBe("browser-use");
    expect(merged.integrations.plugins).toHaveLength(1);
  });

  it("rejects unsupported plugin contributions instead of silently dropping them", async () => {
    const config = configWithPlugins([
      {
        ...contributionPlugin,
        contributions: {
          ...contributionPlugin.contributions,
          skills: [{ id: "browser-smoke", relativePath: "skills/browser-smoke/SKILL.md" }],
          tools: [{ name: "browser.screenshot", description: "Capture a browser screenshot." }],
          releaseGates: [{ id: "browser-smoke-gate", command: "npm run browser:smoke", required: true }]
        }
      }
    ]);

    await expect(initializePlugins(config)).rejects.toThrow(/unsupported contributions: skills, tools, releaseGates/);
  });

  it("preserves quoted lifecycle command arguments", () => {
    expect(
      parseLifecycleCommand(
        'node scripts/init-plugin.mjs --label "Browser smoke testing" --path "C:\\Program Files\\Agent"'
      )
    ).toEqual([
      "node",
      "scripts/init-plugin.mjs",
      "--label",
      "Browser smoke testing",
      "--path",
      "C:\\Program Files\\Agent"
    ]);
  });

  it("preserves intentionally empty quoted lifecycle command arguments", () => {
    expect(parseLifecycleCommand('node scripts/init-plugin.mjs "" --flag')).toEqual([
      "node",
      "scripts/init-plugin.mjs",
      "",
      "--flag"
    ]);
  });

  it("disposes initialized plugins when a later plugin fails", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "plugin-rollback-"));
    try {
      const config = configWithPlugins(
        [
          {
            ...contributionPlugin,
            name: "initialized-plugin",
            initCommand: "node -e \"require('fs').writeFileSync('initialized.txt','1')\"",
            disposeCommand: "node -e \"require('fs').writeFileSync('disposed.txt','1')\""
          },
          {
            ...contributionPlugin,
            name: "rejected-plugin",
            allowlisted: false
          }
        ],
        tempDir
      );

      await expect(initializePlugins(config)).rejects.toThrow(/not allowlisted/);
      expect(existsSync(join(tempDir, "initialized.txt"))).toBe(true);
      expect(existsSync(join(tempDir, "disposed.txt"))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reports dispose command failures when disposing plugins directly", async () => {
    await expect(
      disposePlugins(
        [
          {
            plugin: {
              ...contributionPlugin,
              name: "dispose-fails",
              disposeCommand: 'node -e "process.exit(2)"'
            },
            contribution: contributionPlugin.contributions
          }
        ],
        process.cwd()
      )
    ).rejects.toThrow(/Failed to dispose 1 plugin/);
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StageArtifact, TargetRepoConfig, WorkItem } from "../packages/shared/src";

const envKeys = [
  "AGENT_TEAM_CONFIG",
  "AGENT_LOCAL_CHECKS_PASSED",
  "AGENT_GITHUB_ACTIONS_PASSED",
  "AGENT_SECRET_SCAN_PASSED",
  "AGENT_ROLLBACK_PLAN_PRESENT",
  "AGENT_REQUIRE_RUNTIME_HEALTH",
  "CONTROLLER_HEALTH_URL",
  "AGENT_ROLLBACK_COMMAND",
  "AGENT_COMMAND_TIMEOUT_MS",
  "RELEASE_PROOF_FILE"
] as const;

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<
  (typeof envKeys)[number],
  string | undefined
>;

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("release activities", () => {
  it("blocks the next activity within five seconds when emergency stop is active", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-stop-"));
    const stopFile = path.join(tempDir, "emergency-stop");
    await fs.writeFile(stopFile, "stop", "utf8");
    const { ensureNotStopped } = await loadActivities(fakeStore());

    const startedAt = Date.now();

    await expect(
      ensureNotStopped("WI-STOP", {
        ...targetRepoConfig(tempDir),
        release: {
          ...targetRepoConfig(tempDir).release,
          emergencyStopFile: stopFile
        }
      })
    ).rejects.toThrow(/Emergency stop is active/);

    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("runs rollback and blocks release when post-release health fails", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-release-"));
    const configPath = path.join(tempDir, "agent-team.config.yaml");
    const proofPath = path.join(tempDir, "release-proof.json");
    await fs.writeFile(configPath, configYaml(tempDir), "utf8");
    const store = fakeStore();
    const { performAutonomousRelease } = await loadActivities(store);

    process.env.AGENT_TEAM_CONFIG = configPath;
    process.env.AGENT_LOCAL_CHECKS_PASSED = "true";
    process.env.AGENT_GITHUB_ACTIONS_PASSED = "true";
    process.env.AGENT_SECRET_SCAN_PASSED = "true";
    process.env.AGENT_ROLLBACK_PLAN_PRESENT = "true";
    process.env.AGENT_REQUIRE_RUNTIME_HEALTH = "true";
    process.env.CONTROLLER_HEALTH_URL = "http://127.0.0.1:1/health";
    process.env.AGENT_ROLLBACK_COMMAND = "node -e \"require('fs').writeFileSync('rollback.marker','rolled-back')\"";
    process.env.AGENT_COMMAND_TIMEOUT_MS = "10000";
    process.env.RELEASE_PROOF_FILE = proofPath;

    const artifact = await performAutonomousRelease(workItem(), [verificationArtifact()]);

    await expect(fs.readFile(path.join(tempDir, "release.marker"), "utf8")).resolves.toBe("released");
    await expect(fs.readFile(path.join(tempDir, "rollback.marker"), "utf8")).resolves.toBe("rolled-back");
    expect(artifact.status).toBe("blocked");
    expect(artifact.releaseReadiness).toBe("not_ready");
    expect(artifact.nextStage).toBe("BLOCKED");
    expect(artifact.testsRun).toContain("release:passed");
    expect(artifact.testsRun).toContain("post-release-health:failed");
    expect(artifact.testsRun).toContain("rollback:passed");
    expect(store.updatedStates).toEqual([{ id: "WI-RELEASE", state: "BLOCKED" }]);
  });
});

async function loadActivities(store: ReturnType<typeof fakeStore>) {
  vi.doMock("../apps/controller/src/store", () => ({
    createStore: () => store
  }));
  return import("../apps/worker/src/activities.js");
}

function fakeStore() {
  return {
    updatedStates: [] as Array<{ id: string; state: string }>,
    async init() {},
    async getStatus() {
      return {
        system: {
          emergencyStop: false,
          emergencyReason: ""
        }
      };
    },
    async listProjectConnections() {
      return [];
    },
    async addArtifact() {},
    async addEvent() {},
    async updateWorkItemState(id: string, state: string) {
      this.updatedStates.push({ id, state });
    }
  };
}

function workItem(): WorkItem {
  return {
    id: "WI-RELEASE",
    projectId: "owner-repo",
    repo: "owner/repo",
    title: "Release candidate",
    requestType: "feature",
    priority: "medium",
    state: "RELEASE",
    dependencies: [],
    acceptanceCriteria: ["Rollback executes when health fails"],
    riskLevel: "low",
    frontendNeeded: false,
    backendNeeded: true,
    rndNeeded: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function verificationArtifact(): StageArtifact {
  return {
    artifactId: "verification-release-ready",
    artifactKind: "VerificationReport",
    workItemId: "WI-RELEASE",
    projectId: "owner-repo",
    repo: "owner/repo",
    stage: "VERIFY",
    ownerAgent: "quality-security-privacy-release",
    status: "passed",
    title: "Verification complete",
    summary: "Verification passed with rollback plan.",
    decisions: ["Rollback plan is present."],
    risks: [],
    filesChanged: [],
    testsRun: ["security:passed"],
    releaseReadiness: "ready",
    nextStage: "RELEASE",
    promptHash: "test-prompt",
    skillIds: ["verification-plan"],
    capabilityIds: [],
    bodyJson: {
      workItemId: "WI-RELEASE",
      status: "passed"
    },
    createdAt: new Date().toISOString()
  };
}

function configYaml(repoPath: string): string {
  return `
repo:
  owner: owner
  name: repo
  defaultBranch: main
  localPath: ${JSON.stringify(repoPath)}
project:
  isolation:
    requireExplicitRepoConnection: true
    allowCrossProjectMemory: false
    allowGlobalMemory: false
commands:
  install: "node -e \\"process.exit(0)\\""
  lint: "node -e \\"process.exit(0)\\""
  typecheck: "node -e \\"process.exit(0)\\""
  test: "node -e \\"process.exit(0)\\""
  build: "node -e \\"process.exit(0)\\""
  security: "node -e \\"process.exit(0)\\""
  release: "node -e \\"require('fs').writeFileSync('release.marker','released')\\""
context:
  includeDefaultContextDir: true
  defaultContextDir: .agent-team/context
  maxFiles: 8
  maxBytesPerFile: 12000
  files: []
integrations:
  electron:
    enabled: false
    preferredAutomation: playwright_test
    artifactsDir: .agent-team/artifacts/electron
    requireIsolatedProfile: true
    allowRemoteDebugging: false
    notes: []
  mcpServers: []
  capabilityPacks: []
  plugins: []
models:
  primaryCodingModel: gpt-5.5
  researchModel: gpt-5.5
  reviewModel: gpt-5.5
  fallbackModel: gpt-5.4
  useBestAvailable: true
release:
  mode: autonomous
  githubActionsRequired: false
  requireLocalRemoteSync: false
  requireCleanWorktree: false
  allowedRisk:
    low: autonomous
    medium: autonomous_with_all_gates
    high: autonomous_with_all_gates
  emergencyStopFile: .agent-team/emergency-stop
scheduler:
  mode: chatgpt_pro_assisted
  continuous: true
  pollIntervalSeconds: 60
  maxConcurrentWorkflows: 3
  maxConcurrentAgentRuns: 5
  maxConcurrentRepoWrites: 1
  completeLoopBeforeNextWorkItem: true
  cooldownSecondsAfterFailure: 300
  preferCodexForCodingWork: true
  requireEventTrigger: true
  parallelDiscovery: true
  parallelFrontendBackend: true
  parallelVerificationPlanning: true
  allowParallelWorkItemsWhenDisjoint: true
`;
}

function targetRepoConfig(repoPath: string): TargetRepoConfig {
  return {
    repo: {
      owner: "owner",
      name: "repo",
      defaultBranch: "main",
      localPath: repoPath
    },
    project: {
      isolation: {
        requireExplicitRepoConnection: true,
        allowCrossProjectMemory: false,
        allowGlobalMemory: false
      }
    },
    commands: {
      install: 'node -e "process.exit(0)"',
      lint: 'node -e "process.exit(0)"',
      typecheck: 'node -e "process.exit(0)"',
      test: 'node -e "process.exit(0)"',
      build: 'node -e "process.exit(0)"',
      security: 'node -e "process.exit(0)"',
      release: 'node -e "process.exit(0)"'
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
      plugins: []
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
      githubActionsRequired: false,
      requireLocalRemoteSync: false,
      requireCleanWorktree: false,
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

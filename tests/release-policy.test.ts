import { describe, expect, it } from "vitest";
import { evaluateReleasePolicy, type TargetRepoConfig, type VerificationSignal } from "../packages/shared/src";

const config: TargetRepoConfig = {
  project: {
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
    localPath: "C:/repo/app"
  },
  commands: {
    install: "npm install",
    lint: "npm run lint",
    typecheck: "npm run typecheck",
    test: "npm test",
    build: "npm run build",
    security: "npm audit --audit-level=high",
    release: "gh workflow run release.yml"
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

const goodSignal: VerificationSignal = {
  localChecksPassed: true,
  githubActionsPassed: true,
  cleanWorktree: true,
  localRemoteSynced: true,
  secretScanPassed: true,
  rollbackPlanPresent: true,
  releaseProofPresent: true,
  emergencyStopActive: false,
  riskLevel: "high"
};

describe("release policy", () => {
  it("allows maximum autonomy when every gate passes", () => {
    expect(evaluateReleasePolicy(config, goodSignal)).toMatchObject({
      allowed: true,
      recommendation: "go"
    });
  });

  it("blocks release when GitHub Actions or sync proof is missing", () => {
    const decision = evaluateReleasePolicy(config, {
      ...goodSignal,
      githubActionsPassed: false,
      localRemoteSynced: false
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiredFixes.join(" ")).toContain("GitHub Actions");
    expect(decision.requiredFixes.join(" ")).toContain("synchronized");
  });

  it("forces every automated gate for all-gates risk mode even if config flags are weakened", () => {
    const weakenedConfig: TargetRepoConfig = {
      ...config,
      release: {
        ...config.release,
        githubActionsRequired: false,
        requireCleanWorktree: false,
        requireLocalRemoteSync: false
      }
    };
    const decision = evaluateReleasePolicy(weakenedConfig, {
      ...goodSignal,
      githubActionsPassed: false,
      cleanWorktree: false,
      localRemoteSynced: false
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiredFixes.join(" ")).toContain("GitHub Actions");
    expect(decision.requiredFixes.join(" ")).toContain("worktree");
    expect(decision.requiredFixes.join(" ")).toContain("synchronized");
  });

  it("blocks release when release proof is missing", () => {
    const decision = evaluateReleasePolicy(config, {
      ...goodSignal,
      releaseProofPresent: false
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiredFixes.join(" ")).toContain("Release proof");
  });
});

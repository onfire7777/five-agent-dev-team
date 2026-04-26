import { describe, expect, it } from "vitest";
import { evaluateReleasePolicy, type TargetRepoConfig, type VerificationSignal } from "../packages/shared/src";

const config: TargetRepoConfig = {
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

const goodSignal: VerificationSignal = {
  localChecksPassed: true,
  githubActionsPassed: true,
  cleanWorktree: true,
  localRemoteSynced: true,
  secretScanPassed: true,
  rollbackPlanPresent: true,
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
});

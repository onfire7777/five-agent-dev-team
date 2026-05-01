import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, ProjectConnection, StageArtifact, TargetRepoConfig, WorkItem } from "../packages/shared/src";
import type {
  ControllerStore,
  Direction,
  LoopRun,
  Opportunity,
  OpportunityScanRunInput,
  Proposal,
  StrictProjectScope,
  TeamBusMessage
} from "../apps/controller/src/store";

const envKeys = [
  "AGENT_TEAM_CONFIG",
  "AGENT_LOCAL_CHECKS_PASSED",
  "AGENT_GITHUB_ACTIONS_PASSED",
  "AGENT_SECRET_SCAN_PASSED",
  "AGENT_ROLLBACK_PLAN_PRESENT",
  "AGENT_REQUIRE_RUNTIME_HEALTH",
  "CONTROLLER_HEALTH_URL",
  "AGENT_RELEASE_TAG",
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
    delete process.env.AGENT_RELEASE_TAG;
    process.env.AGENT_ROLLBACK_COMMAND =
      "node -e \"require('fs').writeFileSync('rollback.marker',process.env.AGENT_RELEASE_TAG||'')\"";
    process.env.AGENT_COMMAND_TIMEOUT_MS = "10000";
    process.env.RELEASE_PROOF_FILE = proofPath;

    const artifact = await performAutonomousRelease(workItem(), [verificationArtifact()]);

    const releaseTag = await fs.readFile(path.join(tempDir, "release.marker"), "utf8");
    const rollbackTag = await fs.readFile(path.join(tempDir, "rollback.marker"), "utf8");
    expect(releaseTag).toMatch(/^agent-wi-release-\d{4}-\d{2}-\d{2}T/);
    expect(rollbackTag).toBe(releaseTag);
    expect(artifact.status).toBe("blocked");
    expect(artifact.releaseReadiness).toBe("not_ready");
    expect(artifact.nextStage).toBe("BLOCKED");
    expect(artifact.testsRun).toContain("release:passed");
    expect(artifact.testsRun).toContain("post-release-health:failed");
    expect(artifact.testsRun).toContain("rollback:passed");
    expect(store.updatedStates).toEqual([{ id: "WI-RELEASE", state: "BLOCKED" }]);
  });

  it("runs rollback and does not reuse stale proof when release command fails", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-release-failed-"));
    const configPath = path.join(tempDir, "agent-team.config.yaml");
    const proofPath = path.join(tempDir, "release-proof.json");
    const releaseCommand =
      "node -e \"require('fs').writeFileSync('release.marker',process.env.AGENT_RELEASE_TAG||''); process.exit(1)\"";
    await fs.writeFile(configPath, configYaml(tempDir, releaseCommand), "utf8");
    await fs.writeFile(proofPath, JSON.stringify({ tag: "agent-old-attempt" }), "utf8");
    const store = fakeStore();
    const { performAutonomousRelease } = await loadActivities(store);

    process.env.AGENT_TEAM_CONFIG = configPath;
    process.env.AGENT_LOCAL_CHECKS_PASSED = "true";
    process.env.AGENT_GITHUB_ACTIONS_PASSED = "true";
    process.env.AGENT_SECRET_SCAN_PASSED = "true";
    process.env.AGENT_ROLLBACK_PLAN_PRESENT = "true";
    process.env.AGENT_REQUIRE_RUNTIME_HEALTH = "false";
    delete process.env.AGENT_RELEASE_TAG;
    process.env.AGENT_ROLLBACK_COMMAND =
      "node -e \"require('fs').writeFileSync('rollback.marker',process.env.AGENT_RELEASE_TAG||'')\"";
    process.env.AGENT_COMMAND_TIMEOUT_MS = "10000";
    process.env.RELEASE_PROOF_FILE = proofPath;

    const artifact = await performAutonomousRelease(workItem(), [verificationArtifact()]);

    const releaseTag = await fs.readFile(path.join(tempDir, "release.marker"), "utf8");
    const rollbackTag = await fs.readFile(path.join(tempDir, "rollback.marker"), "utf8");
    expect(rollbackTag).toBe(releaseTag);
    expect(artifact.status).toBe("blocked");
    expect(artifact.testsRun).toContain("release:failed");
    expect(artifact.testsRun).toContain("rollback:passed");
    expect(artifact.testsRun).toContain("release-proof:missing");
    expect(store.updatedStates).toEqual([{ id: "WI-RELEASE", state: "BLOCKED" }]);
  });

  it("detects write-capable GitHub integrations by category", async () => {
    const { hasGithubWriteIntegration } = await loadActivities(fakeStore());
    const config = targetRepoConfig(process.cwd());

    expect(
      hasGithubWriteIntegration({
        ...config,
        integrations: {
          ...config.integrations,
          mcpServers: [
            {
              ...mcpServerDefaults(),
              name: "custom-github",
              category: "github",
              enabled: true,
              transport: "streamable_http",
              url: "https://example.com/mcp"
            }
          ]
        }
      })
    ).toBe(true);

    expect(
      hasGithubWriteIntegration({
        ...config,
        integrations: {
          ...config.integrations,
          mcpServers: [
            {
              ...mcpServerDefaults(),
              name: "github-mcp-read",
              category: "github",
              enabled: true,
              transport: "stdio",
              command: "github-mcp-server",
              args: ["stdio", "--read-only"]
            }
          ]
        }
      })
    ).toBe(false);
  });
});

async function loadActivities(store: ReturnType<typeof fakeStore>) {
  vi.doMock("../apps/controller/src/store", () => ({
    createStore: () => store
  }));
  return import("../apps/worker/src/activities.js");
}

type FakeStore = ControllerStore & {
  updatedStates: Array<{ id: string; state: string }>;
};

function fakeStore(): FakeStore {
  const updatedStates: Array<{ id: string; state: string }> = [];
  return {
    updatedStates,
    async init() {},
    async getStatus() {
      return {
        system: {
          emergencyStop: false,
          emergencyReason: ""
        }
      } as Awaited<ReturnType<ControllerStore["getStatus"]>>;
    },
    async listWorkItems() {
      return [];
    },
    async getWorkItemWithArtifacts() {
      return null;
    },
    async createWorkItem(input) {
      const now = new Date().toISOString();
      return {
        id: "WI-FAKE",
        projectId: input.projectId,
        repo: input.repo,
        title: input.title,
        requestType: input.requestType,
        priority: input.priority,
        state: "NEW",
        dependencies: input.dependencies,
        acceptanceCriteria: input.acceptanceCriteria,
        riskLevel: input.riskLevel,
        frontendNeeded: input.frontendNeeded,
        backendNeeded: input.backendNeeded,
        rndNeeded: input.rndNeeded,
        createdAt: now,
        updatedAt: now
      };
    },
    async listProjectConnections() {
      return [];
    },
    async addArtifact() {},
    async getArtifact() {
      return null;
    },
    async addEvent(event) {
      return {
        sequence: event.sequence ?? 0,
        workItemId: event.workItemId,
        stage: event.stage,
        ownerAgent: event.ownerAgent,
        level: event.level ?? "info",
        type: event.type,
        message: event.message,
        createdAt: event.createdAt ?? new Date().toISOString()
      } satisfies AgentEvent;
    },
    async listEvents() {
      return [];
    },
    async listMemories() {
      return [];
    },
    async addMemories() {},
    async upsertProjectConnection() {
      return fakeProjectConnection();
    },
    async activateProjectConnection() {
      return fakeProjectConnection();
    },
    async deactivateProjectConnection() {
      return fakeProjectConnection({ active: false });
    },
    async listTeamBusMessages() {
      return [];
    },
    async addTeamBusMessage(scope, input) {
      return {
        id: input.id || "bus-fake",
        ...scope,
        workItemId: input.workItemId,
        loopRunId: input.loopRunId,
        from: input.from,
        to: input.to || [],
        kind: input.kind,
        topic: input.topic,
        body: input.body,
        payload: input.payload || {},
        createdAt: new Date().toISOString()
      } satisfies TeamBusMessage;
    },
    async listLoopRuns() {
      return [];
    },
    async upsertLoopRun(scope, input) {
      const now = new Date().toISOString();
      return {
        id: input.id || "loop-fake",
        ...scope,
        workItemId: input.workItemId,
        directionId: input.directionId,
        opportunityId: input.opportunityId,
        proposalId: input.proposalId,
        status: input.status || "running",
        summary: input.summary || "Fake loop run.",
        createdAt: now,
        updatedAt: now,
        closedAt: input.closedAt
      } satisfies LoopRun;
    },
    async getDirection() {
      return null;
    },
    async upsertDirection(scope, input) {
      const now = new Date().toISOString();
      return {
        id: input.id || "direction-fake",
        ...scope,
        title: input.title,
        summary: input.summary,
        goals: input.goals || [],
        constraints: input.constraints || [],
        acceptanceCriteria: input.acceptanceCriteria || [],
        createdAt: now,
        updatedAt: now
      } satisfies Direction;
    },
    async listOpportunities() {
      return [];
    },
    async upsertOpportunity(scope, input) {
      const now = new Date().toISOString();
      return {
        id: input.id || "opportunity-fake",
        ...scope,
        workItemId: input.workItemId,
        title: input.title,
        summary: input.summary,
        source: input.source || "system",
        priority: input.priority || "medium",
        status: input.status || "new",
        tags: input.tags || [],
        createdAt: now,
        updatedAt: now
      } satisfies Opportunity;
    },
    async listOpportunityScanRuns() {
      return [];
    },
    async upsertOpportunityScanRun(scope: StrictProjectScope, input: OpportunityScanRunInput) {
      const now = new Date().toISOString();
      return {
        id: input.id || "scan-fake",
        ...scope,
        status: input.status || "complete",
        sources: input.sources || [],
        repoSha: input.repoSha,
        memoryVersion: input.memoryVersion,
        candidatesCreated: input.candidatesCreated || 0,
        summary: input.summary,
        startedAt: input.startedAt || now,
        completedAt: input.completedAt || now
      };
    },
    async listProposals() {
      return [];
    },
    async upsertProposal(scope, input) {
      return fakeProposal(scope, input);
    },
    async decideProposal(scope, proposalId, input) {
      return {
        ...fakeProposal(scope, {
          id: proposalId,
          title: "Fake proposal",
          summary: "Fake proposal.",
          recommendation: "Proceed."
        }),
        status: input.decision === "reject" ? "rejected" : input.decision === "revise" ? "revising" : "accepted",
        decision: {
          decision: input.decision,
          decidedBy: input.decidedBy,
          reason: input.reason,
          requestedChanges: input.requestedChanges || [],
          decidedAt: new Date().toISOString()
        }
      } satisfies Proposal;
    },
    async claimWorkItemForWorkflow() {
      return true;
    },
    async listWorkflowClaims() {
      return [];
    },
    async releaseWorkItemWorkflowClaim() {},
    async setEmergencyStop() {},
    async updateWorkItemState(id: string, state: string) {
      updatedStates.push({ id, state });
    }
  };
}

function fakeProjectConnection(overrides: Partial<ProjectConnection> = {}): ProjectConnection {
  const now = new Date().toISOString();
  return {
    id: "fake-project",
    projectId: "owner-repo",
    name: "Fake Project",
    repo: "owner/repo",
    repoOwner: "owner",
    repoName: "repo",
    defaultBranch: "main",
    localPath: process.cwd(),
    githubUrl: undefined,
    webResearchEnabled: true,
    githubMcpEnabled: true,
    githubWriteEnabled: false,
    active: true,
    memoryNamespace: "owner-repo",
    contextDir: ".agent-team/context",
    status: "connected",
    ghAvailable: false,
    ghAuthed: false,
    githubMcpAvailable: false,
    githubMcpAuthenticated: false,
    githubSdkConnected: false,
    githubConnected: false,
    remoteMatches: false,
    defaultBranchVerified: false,
    capabilities: [],
    validationErrors: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function fakeProposal(
  scope: StrictProjectScope,
  input: Pick<Proposal, "title" | "summary" | "recommendation"> & Partial<Proposal>
): Proposal {
  const now = new Date().toISOString();
  return {
    id: input.id || "proposal-fake",
    ...scope,
    workItemId: input.workItemId,
    loopRunId: input.loopRunId,
    opportunityId: input.opportunityId,
    title: input.title,
    summary: input.summary,
    researchFindings: input.researchFindings || [],
    options: input.options || [],
    recommendation: input.recommendation,
    acceptanceCriteria: input.acceptanceCriteria || [],
    implementationPlan: input.implementationPlan || [],
    validationPlan: input.validationPlan || [],
    risks: input.risks || [],
    status: input.status || "draft",
    decision: input.decision,
    createdAt: now,
    updatedAt: now
  };
}

function mcpServerDefaults() {
  return {
    activation: { mode: "on_demand" as const, stages: [], agents: [], keywords: [] },
    env: {},
    timeoutSeconds: 30,
    cacheToolsList: true,
    toolAllowlist: [],
    notes: []
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

function configYaml(
  repoPath: string,
  releaseCommand = "node -e \"require('fs').writeFileSync('release.marker',process.env.AGENT_RELEASE_TAG||'')\""
): string {
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
  release: ${JSON.stringify(releaseCommand)}
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

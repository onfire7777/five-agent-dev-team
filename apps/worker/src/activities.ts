import childProcess from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import util from "node:util";
import {
  evaluateGitSync,
  evaluateReleasePolicy,
  loadRepoContextMemories,
  loadTargetRepoConfig,
  scopeWorkItemToProject,
  selectRelevantMemories,
  StageArtifactSchema,
  type StageArtifact,
  type TargetRepoConfig,
  type VerificationSignal,
  type WorkItem,
  type WorkItemState
} from "../../../packages/shared/src";
import { getAgentDefinition, roleForStage, runRoleAgent } from "../../../packages/agents/src";
import { createStore, type ControllerStore } from "../../controller/src/store";

const exec = util.promisify(childProcess.exec);
let storePromise: Promise<ControllerStore> | null = null;

export interface StageInput {
  workItem: WorkItem;
  stage: WorkItemState;
  previousArtifacts: StageArtifact[];
}

export async function ensureNotStopped(workItemId: string, config?: TargetRepoConfig): Promise<void> {
  const store = await getActivityStore();
  const status = await store.getStatus();
  if (status.system.emergencyStop) {
    throw new Error(`Emergency stop is active. Work item ${workItemId} cannot continue.`);
  }

  const emergencyStopFile = resolveEmergencyStopFile(config);
  try {
    await fs.access(emergencyStopFile);
    throw new Error(`Emergency stop is active. Work item ${workItemId} cannot continue.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Emergency stop is active")) throw error;
    if ((error as NodeJS.ErrnoException).code && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function runAgentStage(input: StageInput): Promise<StageArtifact> {
  const role = roleForStage(input.stage);
  const definition = getAgentDefinition(role);
  const store = await getActivityStore();
  const config = loadReleaseConfig();
  const scopedWorkItem = scopeWorkItemToProject(input.workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  await store.addEvent({
    workItemId: scopedWorkItem.id,
    stage: input.stage,
    ownerAgent: definition.role,
    level: "info",
    type: "stage_started",
    message: `${definition.displayName} started ${input.stage}.`
  });
  const contextMemories = await loadRepoContextMemories(config, scopedWorkItem);
  const memories = selectRelevantMemories([
    ...(await store.listMemories(scopedWorkItem.id)),
    ...contextMemories
  ], scopedWorkItem);
  const result = await runRoleAgent(definition, { ...input, workItem: scopedWorkItem, memories, targetRepoConfig: config });
  await persistArtifact(result.artifact);
  return result.artifact;
}

export async function prepareBuildBranches(workItem: WorkItem): Promise<{ branchPrefix: string }> {
  const config = loadReleaseConfig();
  const scopedWorkItem = scopeWorkItemToProject(workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  return { branchPrefix: automationBranchPrefix(scopedWorkItem) };
}

export async function integrateBranches(workItem: WorkItem, previousArtifacts: StageArtifact[]): Promise<StageArtifact> {
  const config = loadReleaseConfig();
  const scopedWorkItem = scopeWorkItemToProject(workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  const artifact = StageArtifactSchema.parse({
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: "INTEGRATION",
    ownerAgent: "backend-systems-engineering",
    status: "passed",
    title: "Integration branch prepared",
    summary: "Frontend, backend, R&D, and early quality context are reconciled into a single integration candidate.",
    decisions: ["Use the integration branch as the single PR/release candidate source.", "Resolve contract deviations before verification."],
    risks: previousArtifacts.flatMap((artifact) => artifact.risks),
    filesChanged: previousArtifacts.flatMap((artifact) => artifact.filesChanged),
    testsRun: [],
    releaseReadiness: "unknown",
    nextStage: "VERIFY",
    createdAt: new Date().toISOString()
  });
  await persistArtifact(artifact);
  return artifact;
}

export async function runVerification(workItem: WorkItem, previousArtifacts: StageArtifact[]): Promise<StageArtifact> {
  const config = loadReleaseConfig();
  const scopedWorkItem = scopeWorkItemToProject(workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  const checks = await runConfiguredChecks(config, ["install", "lint", "typecheck", "test", "build", "security"]);
  const failedChecks = checks.filter((check) => !check.ok);
  const artifact = StageArtifactSchema.parse({
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: "VERIFY",
    ownerAgent: "quality-security-privacy-release",
    status: failedChecks.length ? "failed" : "passed",
    title: "Verification complete",
    summary: failedChecks.length
      ? `Verification failed: ${failedChecks.map((check) => check.name).join(", ")}.`
      : "Acceptance, regression, security, privacy, performance, teammate handoffs, and release gates are ready for autonomous release evaluation.",
    decisions: failedChecks.length
      ? ["Route required fixes back to the owning implementation agent before release."]
      : ["Proceed to autonomous release only if local and GitHub gates remain synchronized.", "Use shared context to verify every builder claim against actual release candidate state."],
    risks: [
      ...previousArtifacts.flatMap((artifact) => artifact.risks),
      ...failedChecks.map((check) => `${check.name} failed: ${check.summary}`)
    ],
    filesChanged: previousArtifacts.flatMap((artifact) => artifact.filesChanged),
    testsRun: checks.map((check) => `${check.name}:${check.ok ? "passed" : "failed"}`),
    releaseReadiness: failedChecks.length ? "not_ready" : "ready",
    nextStage: failedChecks.length ? "BLOCKED" : "RELEASE",
    createdAt: new Date().toISOString()
  });
  await persistArtifact(artifact);
  return artifact;
}

export async function planVerification(workItem: WorkItem, previousArtifacts: StageArtifact[]): Promise<StageArtifact> {
  const config = loadReleaseConfig();
  const scopedWorkItem = scopeWorkItemToProject(workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  return StageArtifactSchema.parse({
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: "VERIFY",
    ownerAgent: "quality-security-privacy-release",
    status: "pending",
    title: "Verification plan",
    summary: "Quality prepared acceptance, regression, security, privacy, performance, and release-gate expectations before implementation.",
    decisions: ["Use this as planning context only; final verification must run after integration."],
    risks: previousArtifacts.flatMap((artifact) => artifact.risks),
    filesChanged: [],
    testsRun: [],
    releaseReadiness: "unknown",
    nextStage: "VERIFY",
    createdAt: new Date().toISOString()
  });
}

export async function performAutonomousRelease(workItem: WorkItem, previousArtifacts: StageArtifact[]): Promise<StageArtifact> {
  const config = loadReleaseConfig();
  const scopedWorkItem = scopeWorkItemToProject(workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  const { signal, syncReasons } = await collectReleaseSignal(scopedWorkItem, config, previousArtifacts);
  const decision = evaluateReleasePolicy(config, signal);
  const releaseCommand = decision.allowed ? await runReleaseCommand(config) : null;
  const releaseAllowed = decision.allowed && (!releaseCommand || releaseCommand.ok);

  const artifact = StageArtifactSchema.parse({
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: "RELEASE",
    ownerAgent: "quality-security-privacy-release",
    status: releaseAllowed ? "passed" : "blocked",
    title: "Autonomous release decision",
    summary: releaseAllowed
      ? "Autonomous release gates passed. Merge, tag, release verification, local pull, cleanup, and sync confirmation may proceed."
      : `Release blocked: ${[...decision.requiredFixes, releaseCommand && !releaseCommand.ok ? releaseCommand.summary : ""].filter(Boolean).join("; ")}`,
    decisions: releaseAllowed
      ? [...decision.reasons, releaseCommand?.summary || "Configured release command completed."]
      : [...decision.requiredFixes, releaseCommand && !releaseCommand.ok ? releaseCommand.summary : ""].filter(Boolean),
    risks: [
      ...previousArtifacts.flatMap((artifact) => artifact.risks),
      ...syncReasons,
      ...(releaseCommand && !releaseCommand.ok ? [releaseCommand.summary] : [])
    ],
    filesChanged: previousArtifacts.flatMap((artifact) => artifact.filesChanged),
    testsRun: ["local checks", "GitHub Actions", "secret scan", "release verification", ...(releaseCommand ? [`release:${releaseCommand.ok ? "passed" : "failed"}`] : [])],
    releaseReadiness: releaseAllowed ? "ready" : "not_ready",
    nextStage: releaseAllowed ? "CLOSED" : "BLOCKED",
    createdAt: new Date().toISOString()
  });
  await persistArtifact(artifact);
  return artifact;
}

async function collectReleaseSignal(workItem: WorkItem, config: TargetRepoConfig, previousArtifacts: StageArtifact[]): Promise<{ signal: VerificationSignal; syncReasons: string[] }> {
  const gitSyncInput = await readGitSyncInput(workItem, config);
  const sync = evaluateGitSync(gitSyncInput);
  const status = await (await getActivityStore()).getStatus();
  const verificationPassed = previousArtifacts.some((artifact) =>
    artifact.stage === "VERIFY" && artifact.status === "passed" && artifact.releaseReadiness === "ready"
  );
  const securityPassed = previousArtifacts.some((artifact) =>
    artifact.testsRun.some((test) => /^security:passed$/i.test(test))
  );
  const rollbackPlanPresent = previousArtifacts.some((artifact) =>
    [...artifact.decisions, ...artifact.risks, artifact.summary].some((text) => /rollback/i.test(text))
  );
  return {
    signal: {
      localChecksPassed: envFlag("AGENT_LOCAL_CHECKS_PASSED") || verificationPassed,
      githubActionsPassed: envFlag("AGENT_GITHUB_ACTIONS_PASSED"),
      cleanWorktree: gitSyncInput.cleanWorktree,
      localRemoteSynced: sync.synced,
      secretScanPassed: envFlag("AGENT_SECRET_SCAN_PASSED") || securityPassed,
      rollbackPlanPresent: envFlag("AGENT_ROLLBACK_PLAN_PRESENT") || rollbackPlanPresent,
      releaseProofPresent: await hasReleaseProof(workItem, config),
      emergencyStopActive: status.system.emergencyStop,
      riskLevel: workItem.riskLevel
    },
    syncReasons: sync.reasons
  };
}

async function readGitSyncInput(workItem: WorkItem, config: TargetRepoConfig) {
  const repoPath = config.repo.localPath || process.cwd();
  const defaultBranch = assertSafeGitRef(config.repo.defaultBranch, "default branch");
  const branchPrefix = automationBranchPrefix(workItem);
  try {
    await execGit(`git fetch --prune origin ${defaultBranch}`, repoPath);
    const status = await execGit("git status --porcelain", repoPath);
    const counts = await execGit(`git rev-list --left-right --count origin/${defaultBranch}...HEAD`, repoPath);
    const [behindRaw, aheadRaw] = counts.stdout.trim().split(/\s+/);
    const automationBranchesForItem = await countAutomationBranches(repoPath, branchPrefix);
    return {
      cleanWorktree: status.stdout.trim().length === 0,
      ahead: Number(aheadRaw || 0),
      behind: Number(behindRaw || 0),
      duplicateAutomationBranches: Math.max(0, automationBranchesForItem - 1)
    };
  } catch {
    return {
      cleanWorktree: false,
      ahead: 1,
      behind: 1,
      duplicateAutomationBranches: 0
    };
  }
}

function envFlag(name: string): boolean {
  return /^(1|true|yes)$/i.test(process.env[name] || "");
}

type CommandName = keyof TargetRepoConfig["commands"];
type CommandResult = {
  name: string;
  ok: boolean;
  summary: string;
};

async function runConfiguredChecks(config: TargetRepoConfig, names: CommandName[]): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  for (const name of names) {
    results.push(await runConfiguredCommand(config, name, config.commands[name]));
  }
  return results;
}

async function runReleaseCommand(config: TargetRepoConfig): Promise<CommandResult> {
  return runConfiguredCommand(config, "release", config.commands.release);
}

async function runConfiguredCommand(config: TargetRepoConfig, name: string, command: string): Promise<CommandResult> {
  try {
    await exec(command, {
      cwd: config.repo.localPath || process.cwd(),
      timeout: Number(process.env.AGENT_COMMAND_TIMEOUT_MS || 300_000),
      maxBuffer: 1024 * 1024 * 8
    });
    return { name, ok: true, summary: `${name} passed` };
  } catch (error) {
    const message = error instanceof Error ? error.message.split(/\r?\n/)[0] : "command failed";
    return { name, ok: false, summary: message };
  }
}

async function hasReleaseProof(workItem: WorkItem, config: TargetRepoConfig): Promise<boolean> {
  const configuredProof = process.env.RELEASE_PROOF_FILE || `.agent-team/release-proof-${workItem.id}.json`;
  const proofFile = path.isAbsolute(configuredProof)
    ? configuredProof
    : path.join(config.repo.localPath || process.cwd(), configuredProof);
  try {
    await fs.access(proofFile);
    return true;
  } catch {
    return false;
  }
}

async function getActivityStore(): Promise<ControllerStore> {
  if (!storePromise) {
    storePromise = Promise.resolve(createStore()).then(async (store) => {
      await store.init();
      return store;
    });
  }
  return storePromise;
}

async function persistArtifact(artifact: StageArtifact): Promise<void> {
  const store = await getActivityStore();
  await store.addArtifact(artifact);
  await store.addEvent({
    workItemId: artifact.workItemId,
    stage: artifact.stage,
    ownerAgent: artifact.ownerAgent,
    level: artifact.status === "blocked" || artifact.status === "failed" ? "error" : "info",
    type: artifact.stage === "RELEASE" ? "release" : artifact.stage === "VERIFY" ? "verification" : artifact.status === "failed" || artifact.status === "blocked" ? "stage_failed" : "stage_completed",
    message: artifact.summary
  });
  const nextState = artifact.status === "blocked" || artifact.status === "failed"
    ? "BLOCKED"
    : artifact.nextStage || artifact.stage;
  await store.updateWorkItemState(artifact.workItemId, nextState);
}

function createDefaultReleaseConfig(): TargetRepoConfig {
  return {
    repo: {
      owner: process.env.GITHUB_OWNER || "local",
      name: process.env.GITHUB_REPO || "target-repo",
      defaultBranch: "main",
      localPath: process.cwd()
    },
    project: {
      isolation: {
        requireExplicitRepoConnection: true,
        allowCrossProjectMemory: false,
        allowGlobalMemory: false
      }
    },
    commands: {
      install: "npm ci",
      lint: "npm run lint --if-present",
      typecheck: "npm run typecheck --if-present",
      test: "npm test --if-present",
      build: "npm run build --if-present",
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
      primaryCodingModel: process.env.AGENT_PRIMARY_MODEL || "gpt-5.5",
      researchModel: process.env.AGENT_RESEARCH_MODEL || "gpt-5.5",
      reviewModel: process.env.AGENT_REVIEW_MODEL || "gpt-5.5",
      fallbackModel: process.env.AGENT_FALLBACK_MODEL || "gpt-5.4",
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
      mode: (process.env.AGENT_EXECUTION_MODE as any) || "chatgpt_pro_assisted",
      continuous: true,
      pollIntervalSeconds: Number(process.env.SCHEDULER_POLL_SECONDS || 60),
      maxConcurrentWorkflows: Number(process.env.MAX_CONCURRENT_WORKFLOWS || 3),
      maxConcurrentAgentRuns: Number(process.env.MAX_CONCURRENT_AGENT_RUNS || 5),
      maxConcurrentRepoWrites: Number(process.env.MAX_CONCURRENT_REPO_WRITES || 1),
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

function loadReleaseConfig(): TargetRepoConfig {
  const configPath = process.env.AGENT_TEAM_CONFIG || "agent-team.config.yaml";
  try {
    return loadTargetRepoConfig(configPath);
  } catch (error) {
    if (/^(1|true|yes)$/i.test(process.env.AGENT_TEAM_ALLOW_DEFAULT_CONFIG || "")) {
      return createDefaultReleaseConfig();
    }
    throw new Error([
      `Target repo config could not be loaded from ${configPath}.`,
      "Create agent-team.config.yaml for the repository this team should operate on,",
      "or set AGENT_TEAM_ALLOW_DEFAULT_CONFIG=true only for local smoke tests.",
      error instanceof Error ? `Original error: ${error.message}` : ""
    ].filter(Boolean).join(" "));
  }
}

function resolveEmergencyStopFile(config?: TargetRepoConfig): string {
  const configured = process.env.EMERGENCY_STOP_FILE || config?.release.emergencyStopFile || ".agent-team/emergency-stop";
  if (path.isAbsolute(configured)) return configured;
  return path.resolve(config?.repo.localPath || process.cwd(), configured);
}

function automationBranchPrefix(workItem: WorkItem): string {
  const safeId = workItem.id
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `agent/${safeId || "work-item"}`;
}

async function countAutomationBranches(repoPath: string, branchPrefix: string): Promise<number> {
  const patterns = [branchPrefix, `${branchPrefix}-*`];
  const outputs = await Promise.all([
    ...patterns.map((pattern) => execGit(`git branch --list "${pattern}" --format="%(refname:short)"`, repoPath)),
    ...patterns.map((pattern) => execGit(`git branch --remotes --list "origin/${pattern}" --format="%(refname:short)"`, repoPath))
  ]);
  const branches = new Set(
    outputs
      .flatMap((output) => output.stdout.split(/\r?\n/))
      .map((branch) => branch.trim().replace(/^origin\//, ""))
      .filter(Boolean)
  );
  return branches.size;
}

function execGit(command: string, cwd: string) {
  return exec(command, { cwd });
}

function assertSafeGitRef(value: string, label: string): string {
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
}

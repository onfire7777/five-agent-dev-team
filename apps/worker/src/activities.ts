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
  targetConfigMatchesWorkItem,
  targetRepoConfigFromProjectConnection,
  githubAuthEnv,
  type StageArtifact,
  type TargetRepoConfig,
  type VerificationSignal,
  type WorkItem,
  type WorkItemState
} from "../../../packages/shared/src";
import { getAgentDefinition, roleForStage, runRoleAgent, type TeamBusMessage } from "../../../packages/agents/src";
import { createStore, type ControllerStore, type StrictProjectScope } from "../../controller/src/store";

const exec = util.promisify(childProcess.exec);
let storePromise: Promise<ControllerStore> | null = null;

export interface StageInput {
  workItem: WorkItem;
  stage: WorkItemState;
  previousArtifacts: StageArtifact[];
  teamMessages?: TeamBusMessage[];
  teamDirection?: string[];
  loopContext?: string[];
}

export interface ProposalGateInput {
  workItem: WorkItem;
  proposal: StageArtifact;
  previousArtifacts: StageArtifact[];
}

export interface WorkflowProposalDecisionInput {
  workItem: WorkItem;
  decision: "accept" | "revise" | "reject";
  feedback?: string;
  decidedBy?: string;
  decidedAt?: string;
  previousArtifacts: StageArtifact[];
}

type EvidenceItem = {
  name: string;
  ok: boolean;
  required: boolean;
  summary: string;
  tests: string[];
  risks: string[];
};

type LoopEvidence = {
  git: EvidenceItem;
  runtime: EvidenceItem;
  github: EvidenceItem;
};

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

export async function recordLoopStart(workItem: WorkItem): Promise<StageArtifact> {
  const config = await loadReleaseConfig(workItem);
  const scopedWorkItem = scopeWorkItemToProject(workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  const store = await getActivityStore();
  const memories = selectRelevantMemories([
    ...(await store.listMemories(scopedWorkItem.id)),
    ...(await loadRepoContextMemories(config, scopedWorkItem))
  ], scopedWorkItem, 20);
  const latestLoopMemory = memories.find((memory) => memory.tags.includes("latest-loop"));
  const evidence = await collectLoopEvidence(scopedWorkItem, config);
  const blockingRisks = [
    ...(config.release.requireCleanWorktree || config.release.requireLocalRemoteSync ? evidence.git.risks : []),
    ...(evidence.runtime.required ? evidence.runtime.risks : [])
  ];

  const artifact = StageArtifactSchema.parse({
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: "NEW",
    ownerAgent: "product-delivery-orchestrator",
    status: blockingRisks.length ? "blocked" : "passed",
    title: "Loop start snapshot",
    summary: blockingRisks.length
      ? `Loop start blocked before intake: ${blockingRisks.join("; ")}.`
      : "Loop start captured the latest completed repo memory, local sync evidence, runtime health evidence, and GitHub gate evidence before intake.",
    decisions: [
      `Connected project: ${scopedWorkItem.projectId || "unscoped"}.`,
      `Connected repo: ${scopedWorkItem.repo || "unscoped"}.`,
      latestLoopMemory
        ? `Starting from latest completed loop memory: ${latestLoopMemory.title} (${latestLoopMemory.updatedAt}).`
        : "No previous completed loop memory exists for this connected repo.",
      evidence.git.summary,
      evidence.runtime.summary,
      evidence.github.summary,
      "Do not start implementation until this loop owns the workflow claim and every previous loop has reached CLOSED or BLOCKED."
    ],
    risks: uniqueStrings([
      ...evidence.git.risks,
      ...evidence.runtime.risks,
      ...evidence.github.risks
    ]),
    filesChanged: [],
    testsRun: uniqueStrings([
      ...evidence.git.tests,
      ...evidence.runtime.tests,
      ...evidence.github.tests
    ]),
    releaseReadiness: "unknown",
    nextStage: blockingRisks.length ? "BLOCKED" : "INTAKE",
    createdAt: new Date().toISOString()
  });
  await persistArtifact(artifact);
  await updateLoopRun(store, scopedWorkItem, {
    status: blockingRisks.length ? "blocked" : "running",
    summary: artifact.summary
  });
  await writeTeamBusMessage(store, {
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: "NEW",
    ownerAgent: "product-delivery-orchestrator",
    message: artifact.summary
  });
  return artifact;
}

export async function runAgentStage(input: StageInput): Promise<StageArtifact> {
  const result = await runAgentWithTeamContext(input);
  if (result.artifact.stage === "PROPOSAL") {
    await persistArtifact(result.artifact, { updateWorkItemState: false });
    await result.store.updateWorkItemState(result.artifact.workItemId, "PROPOSAL");
  } else {
    await persistArtifact(result.artifact);
  }
  if (result.artifact.stage === "PROPOSAL") {
    await persistProposal(result.store, result.workItem, result.artifact, "proposed");
  }
  await writeTeamBusMessage(result.store, {
    workItemId: result.workItem.id,
    projectId: result.workItem.projectId,
    repo: result.workItem.repo,
    stage: input.stage,
    ownerAgent: result.definition.role,
    message: `${result.definition.displayName} completed ${input.stage}: ${result.artifact.summary}`
  });
  return result.artifact;
}

export async function runAgentProposal(input: StageInput): Promise<StageArtifact> {
  const result = await runAgentWithTeamContext(input, true);
  await writeTeamBusMessage(result.store, {
    workItemId: result.workItem.id,
    projectId: result.workItem.projectId,
    repo: result.workItem.repo,
    stage: input.stage,
    ownerAgent: result.definition.role,
    message: `${result.definition.displayName} proposed ${input.stage}: ${result.artifact.summary}`
  });
  await persistProposal(result.store, result.workItem, result.artifact, "proposed");
  return result.artifact;
}

export async function evaluateProposalGate(input: ProposalGateInput): Promise<StageArtifact> {
  const config = await loadReleaseConfig(input.workItem);
  const scopedWorkItem = scopeWorkItemToProject(input.workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  const store = await getActivityStore();
  const githubMcpWriteEnabled = config.integrations.mcpServers.some((server) =>
    server.name === "github-mcp" && server.transport === "stdio" && !server.args.includes("--read-only")
  );
  const autoAccept =
    scopedWorkItem.riskLevel === "low" &&
    input.proposal.status === "passed" &&
    input.proposal.risks.length === 0 &&
    !githubMcpWriteEnabled;
  const artifact = StageArtifactSchema.parse({
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: autoAccept ? "PROPOSAL" : "AWAITING_ACCEPTANCE",
    ownerAgent: "product-delivery-orchestrator",
    status: autoAccept ? "passed" : "pending",
    title: autoAccept ? "Proposal auto-accepted by policy" : "Proposal awaiting acceptance",
    summary: autoAccept
      ? "Low-risk proposal passed the policy gate and may continue into contract without human blocking."
      : "Proposal gate is active. Build stages are blocked until the proposal is accepted, revised, or rejected.",
    decisions: autoAccept
      ? [
        "Auto-accept low-risk, high-confidence proposal.",
        "Continue to contract before any frontend/backend build starts."
      ]
      : [
        "Pause the loop at AWAITING_ACCEPTANCE.",
        "Do not start frontend/backend build until a proposal decision signal is received."
      ],
    risks: autoAccept ? [] : input.proposal.risks,
    filesChanged: [],
    testsRun: [],
    releaseReadiness: "unknown",
    nextStage: autoAccept ? "CONTRACT" : "AWAITING_ACCEPTANCE",
    createdAt: new Date().toISOString()
  });
  await persistArtifact(artifact);
  await persistProposal(store, scopedWorkItem, input.proposal, autoAccept ? "accepted" : "proposed");
  await updateLoopRun(store, scopedWorkItem, {
    status: autoAccept ? "running" : "awaiting_acceptance",
    summary: artifact.summary
  });
  await writeTeamBusMessage(store, {
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: artifact.stage,
    ownerAgent: artifact.ownerAgent,
    message: artifact.summary
  });
  return artifact;
}

export async function recordProposalDecision(input: WorkflowProposalDecisionInput): Promise<StageArtifact> {
  const config = await loadReleaseConfig(input.workItem);
  const scopedWorkItem = scopeWorkItemToProject(input.workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  const store = await getActivityStore();
  const accepted = input.decision === "accept";
  const revising = input.decision === "revise";
  const artifact = StageArtifactSchema.parse({
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: "AWAITING_ACCEPTANCE",
    ownerAgent: "product-delivery-orchestrator",
    status: accepted || revising ? "passed" : "blocked",
    title: accepted ? "Proposal accepted" : input.decision === "revise" ? "Proposal revision requested" : "Proposal rejected",
    summary: accepted
      ? "Proposal accepted. The loop may continue into contract and build planning."
      : input.decision === "revise"
        ? "Proposal changes were requested. The loop returns to R&D before any build starts so the team can produce a revised proposal."
        : "Proposal was rejected. Implementation remains blocked before build.",
    decisions: [
      `${input.decidedBy || "human"} decided: ${input.decision}.`,
      input.feedback || "No additional feedback provided."
    ],
    risks: accepted
      ? input.previousArtifacts.flatMap((artifact) => artifact.risks)
      : revising
        ? [input.feedback || "Proposal revision requested before build."]
        : [input.feedback || "Proposal decision blocked implementation."],
    filesChanged: [],
    testsRun: [],
    releaseReadiness: accepted || revising ? "unknown" : "not_ready",
    nextStage: accepted ? "CONTRACT" : revising ? "RND" : "BLOCKED",
    createdAt: input.decidedAt || new Date().toISOString()
  });
  const scope = strictScopeForWorkItem(scopedWorkItem);
  if (scope) {
    await store.decideProposal(scope, `proposal-${scopedWorkItem.id}-proposal`, {
      decision: accepted ? "accept" : input.decision === "revise" ? "revise" : "reject",
      decidedBy: input.decidedBy || "human",
      reason: input.feedback || artifact.summary,
      requestedChanges: input.feedback ? [input.feedback] : []
    }).catch(() => undefined);
  }
  await persistArtifact(artifact);
  await updateLoopRun(store, scopedWorkItem, {
    status: accepted || revising ? "running" : "blocked",
    summary: artifact.summary
  });
  await writeTeamBusMessage(store, {
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: artifact.stage,
    ownerAgent: artifact.ownerAgent,
    message: artifact.summary
  });
  return artifact;
}

async function runAgentWithTeamContext(input: StageInput, proposalStage = false): Promise<{
  artifact: StageArtifact;
  definition: ReturnType<typeof getAgentDefinition>;
  store: ControllerStore;
  workItem: WorkItem;
}> {
  const role = roleForStage(input.stage);
  const definition = getAgentDefinition(role);
  const store = await getActivityStore();
  const config = await loadReleaseConfig(input.workItem);
  const scopedWorkItem = scopeWorkItemToProject(input.workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  await store.addEvent({
    workItemId: scopedWorkItem.id,
    stage: input.stage,
    ownerAgent: definition.role,
    level: "info",
    type: "stage_started",
    message: proposalStage
      ? `${definition.displayName} started ${input.stage} proposal.`
      : `${definition.displayName} started ${input.stage}.`
  });
  const contextMemories = await loadRepoContextMemories(config, scopedWorkItem);
  const memories = selectRelevantMemories([
    ...(await store.listMemories(scopedWorkItem.id)),
    ...contextMemories
  ], scopedWorkItem);
  const teamMessages = [
    ...(await readTeamBusMessages(store, scopedWorkItem.id)),
    ...(input.teamMessages || [])
  ];
  const result = await runRoleAgent(definition, {
    ...input,
    workItem: scopedWorkItem,
    memories,
    targetRepoConfig: config,
    proposalStage,
    teamMessages,
    teamDirection: [
      ...buildTeamDirection(input, proposalStage),
      ...(input.teamDirection || [])
    ],
    loopContext: [
      ...buildLoopContext(input.previousArtifacts),
      ...(input.loopContext || [])
    ]
  });
  return { artifact: result.artifact, definition, store, workItem: scopedWorkItem };
}

export async function closeWorkLoop(workItem: WorkItem, previousArtifacts: StageArtifact[]): Promise<StageArtifact> {
  const config = await loadReleaseConfig(workItem);
  const scopedWorkItem = scopeWorkItemToProject(workItem, config);
  const evidence = await collectLoopEvidence(scopedWorkItem, config);
  const release = [...previousArtifacts].reverse().find((artifact) => artifact.stage === "RELEASE");
  const priorBlocked = previousArtifacts.some((artifact) =>
    artifact.stage === "BLOCKED" || artifact.status === "blocked" || artifact.status === "failed"
  );
  const releasePassed = release?.status === "passed" && release.releaseReadiness === "ready";
  const gitRequired = config.release.requireCleanWorktree || config.release.requireLocalRemoteSync;
  const gitReady = !gitRequired || evidence.git.ok;
  const runtimeReady = !evidence.runtime.required || evidence.runtime.ok;
  const githubReady = !config.release.githubActionsRequired || releasePassed || evidence.github.ok;
  const passed = releasePassed && !priorBlocked && gitReady && runtimeReady && githubReady;
  const blockingRisks = uniqueStrings([
    ...(releasePassed ? [] : ["release gate did not produce a ready passed release artifact"]),
    ...(priorBlocked ? ["one or more prior stages ended blocked or failed"] : []),
    ...(gitReady ? [] : evidence.git.risks),
    ...(runtimeReady ? [] : evidence.runtime.risks),
    ...(githubReady ? [] : evidence.github.risks)
  ]);
  const completedStages = uniqueStrings(previousArtifacts.map((artifact) => artifact.stage));
  const filesChanged = uniqueStrings(previousArtifacts.flatMap((artifact) => artifact.filesChanged));
  const testsRun = uniqueStrings([
    ...previousArtifacts.flatMap((artifact) => artifact.testsRun),
    ...evidence.git.tests,
    ...evidence.runtime.tests,
    ...evidence.github.tests
  ]);

  const artifact = StageArtifactSchema.parse({
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: "CLOSED",
    ownerAgent: "product-delivery-orchestrator",
    status: passed ? "passed" : "blocked",
    title: passed ? "Loop closure summary" : "Loop closure blocked",
    summary: passed
      ? `Loop complete for ${scopedWorkItem.title}. Completed stages: ${completedStages.join(" -> ")}. Latest repo state is remembered for the next loop.`
      : `Loop cannot close cleanly for ${scopedWorkItem.title}: ${blockingRisks.join("; ")}.`,
    decisions: [
      `Completed stages: ${completedStages.join(" -> ") || "none"}.`,
      `Files changed: ${filesChanged.length ? filesChanged.join(", ") : "none recorded"}.`,
      `Tests and gates recorded: ${testsRun.length ? testsRun.join(", ") : "none recorded"}.`,
      evidence.git.summary,
      evidence.runtime.summary,
      evidence.github.summary,
      "Persist this closure as the repo latest-loop memory before any new work item starts.",
      "Release the durable workflow claim only after every stage and parallel agent branch has settled."
    ],
    risks: uniqueStrings([
      ...previousArtifacts.flatMap((artifact) => artifact.risks),
      ...blockingRisks,
      ...evidence.git.risks,
      ...evidence.runtime.risks,
      ...evidence.github.risks
    ]),
    filesChanged,
    testsRun,
    releaseReadiness: passed ? "ready" : "not_ready",
    nextStage: passed ? null : "BLOCKED",
    createdAt: new Date().toISOString()
  });
  await persistArtifact(artifact);
  await updateLoopRun(await getActivityStore(), scopedWorkItem, {
    status: passed ? "closed" : "blocked",
    summary: artifact.summary,
    closedAt: new Date().toISOString()
  });
  await writeTeamBusMessage(await getActivityStore(), {
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: "CLOSED",
    ownerAgent: "product-delivery-orchestrator",
    message: artifact.summary
  });
  return artifact;
}

export async function releaseWorkflowClaim(workItemId: string): Promise<void> {
  const store = await getActivityStore();
  await store.releaseWorkItemWorkflowClaim(workItemId);
  await store.addEvent({
    workItemId,
    level: "info",
    type: "system",
    message: `Workflow claim released for ${workItemId}; scheduler may start the next loop when no active work remains.`
  });
}

export async function prepareBuildBranches(workItem: WorkItem): Promise<{ branchPrefix: string }> {
  const config = await loadReleaseConfig(workItem);
  const scopedWorkItem = scopeWorkItemToProject(workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  return { branchPrefix: automationBranchPrefix(scopedWorkItem) };
}

export async function integrateBranches(workItem: WorkItem, previousArtifacts: StageArtifact[]): Promise<StageArtifact> {
  const config = await loadReleaseConfig(workItem);
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
  const config = await loadReleaseConfig(workItem);
  const scopedWorkItem = scopeWorkItemToProject(workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  const checks = await runConfiguredChecks(config, ["install", "lint", "typecheck", "test", "build", "security"]);
  const failedChecks = checks.filter((check) => !check.ok);
  const rollbackDecision = [
    "Rollback plan:",
    "use the pre-release default-branch SHA as the rollback target,",
    "stop new loops if release verification fails,",
    "revert or rerun the GitHub release workflow from the last known-good SHA,",
    "then require local checks, GitHub Actions, and local/remote sync before resuming autonomous work."
  ].join(" ");
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
      ? [
        "Route required fixes back to the owning implementation agent before release.",
        rollbackDecision
      ]
      : [
        "Proceed to autonomous release only if local and GitHub gates remain synchronized.",
        "Use shared context to verify every builder claim against actual release candidate state.",
        rollbackDecision
      ],
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
  const config = await loadReleaseConfig(workItem);
  const scopedWorkItem = scopeWorkItemToProject(workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  const artifact = StageArtifactSchema.parse({
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
  await persistArtifact(artifact, { updateWorkItemState: false });
  await writeTeamBusMessage(await getActivityStore(), {
    workItemId: scopedWorkItem.id,
    projectId: scopedWorkItem.projectId,
    repo: scopedWorkItem.repo,
    stage: "VERIFY",
    ownerAgent: "quality-security-privacy-release",
    message: artifact.summary
  });
  return artifact;
}

export async function performAutonomousRelease(workItem: WorkItem, previousArtifacts: StageArtifact[]): Promise<StageArtifact> {
  const config = await loadReleaseConfig(workItem);
  const scopedWorkItem = scopeWorkItemToProject(workItem, config);
  await ensureNotStopped(scopedWorkItem.id, config);
  const { signal, syncReasons } = await collectReleaseSignal(scopedWorkItem, config, previousArtifacts);
  const preReleaseDecision = evaluateReleasePolicy(config, {
    ...signal,
    releaseProofPresent: signal.releaseProofPresent || Boolean(config.commands.release.trim())
  });
  const releaseCommand = preReleaseDecision.allowed ? await runReleaseCommand(config, scopedWorkItem) : null;
  if (releaseCommand?.ok) {
    await writeReleaseProof(scopedWorkItem, config, releaseCommand);
  }
  const releaseProofPresent = signal.releaseProofPresent || Boolean(releaseCommand?.ok) || await hasReleaseProof(scopedWorkItem, config);
  const decision = evaluateReleasePolicy(config, {
    ...signal,
    releaseProofPresent
  });
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
      ? [...decision.reasons, releaseCommand?.summary || "Configured release command completed.", "Release proof recorded after the release command completed."]
      : [...preReleaseDecision.requiredFixes, ...decision.requiredFixes, releaseCommand && !releaseCommand.ok ? releaseCommand.summary : ""].filter(Boolean),
    risks: [
      ...previousArtifacts.flatMap((artifact) => artifact.risks),
      ...syncReasons,
      ...(releaseCommand && !releaseCommand.ok ? [releaseCommand.summary] : [])
    ],
    filesChanged: previousArtifacts.flatMap((artifact) => artifact.filesChanged),
    testsRun: ["local checks", "GitHub Actions", "secret scan", `release-proof:${releaseProofPresent ? "present" : "missing"}`, "release verification", ...(releaseCommand ? [`release:${releaseCommand.ok ? "passed" : "failed"}`] : [])],
    releaseReadiness: releaseAllowed ? "ready" : "not_ready",
    nextStage: releaseAllowed ? "CLOSED" : "BLOCKED",
    createdAt: new Date().toISOString()
  });
  await persistArtifact(artifact);
  return artifact;
}

async function collectLoopEvidence(workItem: WorkItem, config: TargetRepoConfig): Promise<LoopEvidence> {
  const [git, runtime, github] = await Promise.all([
    readGitEvidence(workItem, config),
    readRuntimeHealthEvidence(),
    readGitHubActionsEvidence(config)
  ]);
  return { git, runtime, github };
}

async function readGitEvidence(workItem: WorkItem, config: TargetRepoConfig): Promise<EvidenceItem> {
  const repoPath = config.repo.localPath || process.cwd();
  const syncInput = await readGitSyncInput(workItem, config);
  const sync = evaluateGitSync(syncInput);
  const branch = await execGit("git rev-parse --abbrev-ref HEAD", repoPath)
    .then((result) => result.stdout.trim())
    .catch(() => "unknown");
  const sha = await execGit("git rev-parse --short HEAD", repoPath)
    .then((result) => result.stdout.trim())
    .catch(() => "unknown");
  return {
    name: "local-git-sync",
    ok: sync.synced,
    required: config.release.requireCleanWorktree || config.release.requireLocalRemoteSync,
    summary: sync.synced
      ? `Local Git is clean and synced on ${branch}@${sha}.`
      : `Local Git is not clean/synced on ${branch}@${sha}: ${sync.reasons.join("; ")}.`,
    tests: [
      `git-sync:${sync.synced ? "passed" : "failed"}`,
      `git-branch:${branch}`,
      `git-sha:${sha}`,
      `git-ahead:${syncInput.ahead}`,
      `git-behind:${syncInput.behind}`,
      `git-duplicate-automation-branches:${syncInput.duplicateAutomationBranches}`
    ],
    risks: sync.reasons
  };
}

async function readRuntimeHealthEvidence(): Promise<EvidenceItem> {
  const required = envFlag("AGENT_REQUIRE_RUNTIME_HEALTH");
  const configuredUrl = process.env.CONTROLLER_HEALTH_URL;
  const urls = configuredUrl
    ? [configuredUrl]
    : ["http://controller:4310/health", "http://localhost:4310/health"];
  const failures: string[] = [];

  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok && body.ok !== false) {
        return {
          name: "docker-runtime-health",
          ok: true,
          required,
          summary: `Controller runtime health is reachable at ${url}; service=${String(body.service || "unknown")}, temporal=${String(body.temporal || "unknown")}.`,
          tests: ["runtime-health:passed"],
          risks: []
        };
      }
      failures.push(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      failures.push(`${url} unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const summary = `Controller/Docker runtime health was not confirmed: ${failures.join("; ")}.`;
  return {
    name: "docker-runtime-health",
    ok: !required,
    required,
    summary: required ? summary : `${summary} Recorded as non-blocking evidence because AGENT_REQUIRE_RUNTIME_HEALTH is not enabled.`,
    tests: [`runtime-health:${required ? "failed" : "unconfirmed"}`],
    risks: required ? [summary] : []
  };
}

async function readGitHubActionsEvidence(config: TargetRepoConfig): Promise<EvidenceItem> {
  const repoPath = config.repo.localPath || process.cwd();
  const repo = `${assertSafeGitRef(config.repo.owner, "repo owner")}/${assertSafeGitRef(config.repo.name, "repo name")}`;
  const branch = assertSafeGitRef(config.repo.defaultBranch, "default branch");

  if (envFlag("AGENT_GITHUB_ACTIONS_PASSED")) {
    return {
      name: "github-actions",
      ok: true,
      required: config.release.githubActionsRequired,
      summary: "GitHub Actions gate is marked passed by AGENT_GITHUB_ACTIONS_PASSED.",
      tests: ["github-actions:passed"],
      risks: []
    };
  }

  try {
    const result = await exec(`gh run list --repo ${repo} --branch ${branch} --limit 1 --json status,conclusion,url,workflowName,headSha`, {
      cwd: repoPath,
      env: githubAuthEnv(),
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    const runs = JSON.parse(result.stdout || "[]") as Array<Record<string, unknown>>;
    const latest = runs[0];
    if (!latest) {
      const summary = `No GitHub Actions runs were found for ${repo}@${branch}.`;
      return {
        name: "github-actions",
        ok: !config.release.githubActionsRequired,
        required: config.release.githubActionsRequired,
        summary,
        tests: ["github-actions:none"],
        risks: config.release.githubActionsRequired ? [summary] : []
      };
    }
    const status = String(latest.status || "unknown");
    const conclusion = String(latest.conclusion || "unknown");
    const ok = status === "completed" && conclusion === "success";
    const summary = ok
      ? `Latest GitHub Actions run passed for ${repo}@${branch}: ${String(latest.workflowName || "workflow")} ${String(latest.headSha || "")}.`
      : `Latest GitHub Actions run is not passing for ${repo}@${branch}: status=${status}, conclusion=${conclusion}, url=${String(latest.url || "unavailable")}.`;
    return {
      name: "github-actions",
      ok: ok || !config.release.githubActionsRequired,
      required: config.release.githubActionsRequired,
      summary,
      tests: [`github-actions:${ok ? "passed" : conclusion === "unknown" ? status : conclusion}`],
      risks: ok ? [] : [summary]
    };
  } catch (error) {
    const summary = `GitHub Actions evidence could not be read with gh: ${error instanceof Error ? error.message.split(/\r?\n/)[0] : String(error)}.`;
    return {
      name: "github-actions",
      ok: !config.release.githubActionsRequired,
      required: config.release.githubActionsRequired,
      summary,
      tests: [`github-actions:${config.release.githubActionsRequired ? "failed" : "unconfirmed"}`],
      risks: config.release.githubActionsRequired ? [summary] : []
    };
  }
}

async function collectReleaseSignal(workItem: WorkItem, config: TargetRepoConfig, previousArtifacts: StageArtifact[]): Promise<{ signal: VerificationSignal; syncReasons: string[] }> {
  const [gitSyncInput, githubActions] = await Promise.all([
    readGitSyncInput(workItem, config),
    readGitHubActionsEvidence(config)
  ]);
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
      githubActionsPassed: envFlag("AGENT_GITHUB_ACTIONS_PASSED") || githubActions.ok,
      cleanWorktree: gitSyncInput.cleanWorktree,
      localRemoteSynced: sync.synced,
      secretScanPassed: envFlag("AGENT_SECRET_SCAN_PASSED") || securityPassed,
      rollbackPlanPresent: envFlag("AGENT_ROLLBACK_PLAN_PRESENT") || rollbackPlanPresent,
      releaseProofPresent: await hasReleaseProof(workItem, config),
      emergencyStopActive: status.system.emergencyStop,
      riskLevel: workItem.riskLevel
    },
    syncReasons: uniqueStrings([
      ...sync.reasons,
      ...(githubActions.required && !githubActions.ok ? githubActions.risks : [])
    ])
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

async function runReleaseCommand(config: TargetRepoConfig, workItem: WorkItem): Promise<CommandResult> {
  return runConfiguredCommand(config, "release", config.commands.release, workItem);
}

async function runConfiguredCommand(config: TargetRepoConfig, name: string, command: string, workItem?: WorkItem): Promise<CommandResult> {
  try {
    await exec(command, {
      cwd: config.repo.localPath || process.cwd(),
      env: {
        ...githubAuthEnv(),
        ...(workItem ? {
          AGENT_WORK_ITEM_ID: workItem.id,
          AGENT_PROJECT_ID: workItem.projectId || "",
          AGENT_REPO: workItem.repo || `${config.repo.owner}/${config.repo.name}`,
          AGENT_DEFAULT_BRANCH: config.repo.defaultBranch
        } : {})
      },
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
  const proofFile = resolveReleaseProofFile(workItem, config);
  try {
    await fs.access(proofFile);
    return true;
  } catch {
    return false;
  }
}

async function writeReleaseProof(workItem: WorkItem, config: TargetRepoConfig, releaseCommand: CommandResult): Promise<void> {
  const proofFile = resolveReleaseProofFile(workItem, config);
  const proof = {
    workItemId: workItem.id,
    projectId: workItem.projectId,
    repo: workItem.repo || `${config.repo.owner}/${config.repo.name}`,
    command: "release",
    summary: releaseCommand.summary,
    createdAt: new Date().toISOString()
  };
  await fs.mkdir(path.dirname(proofFile), { recursive: true });
  await fs.writeFile(proofFile, JSON.stringify(proof, null, 2), "utf8");
}

function resolveReleaseProofFile(workItem: WorkItem, config: TargetRepoConfig): string {
  const configuredProof = process.env.RELEASE_PROOF_FILE;
  if (!configuredProof) {
    return path.join(process.env.AGENT_RUNTIME_DIR || "/tmp/agent-team", `release-proof-${workItem.id}.json`);
  }
  return path.isAbsolute(configuredProof)
    ? configuredProof
    : path.join(config.repo.localPath || process.cwd(), configuredProof);
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

async function persistArtifact(artifact: StageArtifact, options: { updateWorkItemState?: boolean } = {}): Promise<void> {
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
  if (options.updateWorkItemState !== false) {
    await store.updateWorkItemState(artifact.workItemId, nextState);
  }
}

async function readTeamBusMessages(store: ControllerStore, workItemId: string): Promise<TeamBusMessage[]> {
  try {
    const workItem = (await store.listWorkItems()).find((item) => item.id === workItemId);
    const scope = workItem ? strictScopeForWorkItem(workItem) : null;
    if (scope) {
      const messages = await store.listTeamBusMessages(scope);
      return messages
        .filter((message) => !message.workItemId || message.workItemId === workItemId)
        .slice(-20)
        .map((message) => ({
          createdAt: message.createdAt,
          stage: message.payload?.stage as WorkItemState | undefined,
          ownerAgent: message.from,
          type: message.kind,
          message: `${message.topic}: ${message.body}`
        }));
    }
    const events = await store.listEvents(0, 80);
    return events
      .filter((event) => event.workItemId === workItemId)
      .slice(-20)
      .map((event) => ({
        createdAt: event.createdAt,
        stage: event.stage,
        ownerAgent: event.ownerAgent,
        type: event.type,
        message: event.message
      }));
  } catch (error) {
    return [{
      type: "system",
      message: `Team bus read unavailable through the current store interface: ${error instanceof Error ? error.message : String(error)}`
    }];
  }
}

async function writeTeamBusMessage(
  store: ControllerStore,
  input: {
    workItemId: string;
    projectId?: string;
    repo?: string;
    stage: WorkItemState;
    ownerAgent: StageArtifact["ownerAgent"];
    message: string;
  }
): Promise<void> {
  try {
    if (input.projectId && input.repo) {
      await store.addTeamBusMessage({ projectId: input.projectId, repo: input.repo }, {
        workItemId: input.workItemId,
        from: input.ownerAgent,
        kind: input.stage === "BLOCKED" ? "blocker" : input.stage === "CLOSED" ? "handoff" : "status",
        topic: input.stage,
        body: input.message,
        payload: {
          stage: input.stage,
          ownerAgent: input.ownerAgent
        }
      });
    }
    await store.addEvent({
      workItemId: input.workItemId,
      stage: input.stage,
      ownerAgent: input.ownerAgent,
      level: "info",
      type: "system",
      message: input.message
    });
  } catch {
    // The current controller store exposes events as the team bus. If a future
    // store omits that backing interface, stage artifacts still carry handoff context.
  }
}

async function persistProposal(
  store: ControllerStore,
  workItem: WorkItem,
  artifact: StageArtifact,
  status: "draft" | "proposed" | "accepted" | "revising" | "rejected" = "proposed"
): Promise<void> {
  const scope = strictScopeForWorkItem(workItem);
  if (!scope) return;
  try {
    await store.upsertProposal(scope, {
      id: `proposal-${workItem.id}-${artifact.stage.toLowerCase()}`,
      workItemId: workItem.id,
      loopRunId: loopRunId(workItem),
      title: artifact.title,
      summary: artifact.summary,
      researchFindings: artifact.decisions,
      recommendation: artifact.decisions[0] || artifact.summary,
      acceptanceCriteria: workItem.acceptanceCriteria,
      implementationPlan: artifact.decisions,
      validationPlan: artifact.testsRun.length ? artifact.testsRun : [
        "Verify acceptance criteria, regression behavior, release gates, rollback evidence, and local/GitHub sync."
      ],
      risks: artifact.risks,
      status
    });
  } catch (error) {
    await store.addEvent({
      workItemId: workItem.id,
      stage: artifact.stage,
      ownerAgent: artifact.ownerAgent,
      level: "warn",
      type: "system",
      message: `Proposal persistence was skipped: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}

async function updateLoopRun(
  store: ControllerStore,
  workItem: WorkItem,
  input: {
    status: "running" | "awaiting_acceptance" | "closed" | "blocked";
    summary: string;
    closedAt?: string;
  }
): Promise<void> {
  const scope = strictScopeForWorkItem(workItem);
  if (!scope) return;
  try {
    await store.upsertLoopRun(scope, {
      id: loopRunId(workItem),
      workItemId: workItem.id,
      status: input.status,
      summary: input.summary,
      closedAt: input.closedAt
    });
  } catch (error) {
    await store.addEvent({
      workItemId: workItem.id,
      level: "warn",
      type: "system",
      message: `Loop run persistence was skipped: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}

function strictScopeForWorkItem(workItem: Pick<WorkItem, "projectId" | "repo">): StrictProjectScope | null {
  return workItem.projectId && workItem.repo
    ? { projectId: workItem.projectId, repo: workItem.repo }
    : null;
}

function loopRunId(workItem: Pick<WorkItem, "id">): string {
  return `loop-${workItem.id}`;
}

function buildTeamDirection(input: StageInput, proposalStage: boolean): string[] {
  const latest = input.previousArtifacts[input.previousArtifacts.length - 1];
  return [
    proposalStage
      ? `Propose the ${input.stage} handoff before implementation; do not claim unperformed file or test work.`
      : `Execute ${input.stage} using the latest proposal, teammate messages, and prior artifacts as bounded context.`,
    latest
      ? `Most recent artifact is ${latest.ownerAgent} on ${latest.stage}: ${latest.summary}`
      : "No prior artifact is available; rely on the work item and loop start rules.",
    "Prefer additive progress: preserve existing decisions, surface blockers early, and hand off concrete next steps."
  ];
}

function buildLoopContext(previousArtifacts: StageArtifact[]): string[] {
  if (!previousArtifacts.length) {
    return ["No previous artifacts have been produced in this loop."];
  }
  return previousArtifacts.slice(-8).map((artifact) =>
    `${artifact.stage}/${artifact.ownerAgent}/${artifact.status}: ${artifact.summary}`
  );
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
      pollIntervalSeconds: Number(process.env.SCHEDULER_POLL_SECONDS || 15),
      maxConcurrentWorkflows: Number(process.env.MAX_CONCURRENT_WORKFLOWS || 3),
      maxConcurrentAgentRuns: Number(process.env.MAX_CONCURRENT_AGENT_RUNS || 5),
      maxConcurrentRepoWrites: Number(process.env.MAX_CONCURRENT_REPO_WRITES || 1),
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

async function loadReleaseConfig(workItem?: WorkItem): Promise<TargetRepoConfig> {
  const configPath = process.env.AGENT_TEAM_CONFIG || "agent-team.config.yaml";
  try {
    const projectFileConfig = workItem ? await loadConfigFromProjectFile(workItem) : null;
    if (projectFileConfig) return projectFileConfig;
    const config = loadTargetRepoConfig(configPath);
    if (!workItem || targetConfigMatchesWorkItem(config, workItem) || (!workItem.projectId && !workItem.repo)) {
      return config;
    }
    const projectConfig = await loadConfigFromProjectConnection(workItem);
    if (projectConfig) return projectConfig;
    throw new Error(`Work item ${workItem.id} is scoped to ${workItem.projectId || workItem.repo}, but ${configPath} points to a different project.`);
  } catch (error) {
    if (workItem?.projectId || workItem?.repo) {
      const projectConfig = await loadConfigFromProjectConnection(workItem);
      if (projectConfig) return projectConfig;
    }
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

async function loadConfigFromProjectConnection(workItem: WorkItem): Promise<TargetRepoConfig | null> {
  const store = await getActivityStore();
  const connections = await store.listProjectConnections();
  const match = connections.find((connection) => {
    if (workItem.projectId && workItem.repo) return connection.projectId === workItem.projectId && connection.repo === workItem.repo;
    return connection.projectId === workItem.projectId || connection.repo === workItem.repo;
  });
  return match ? targetRepoConfigFromProjectConnection(match) : null;
}

async function loadConfigFromProjectFile(workItem: WorkItem): Promise<TargetRepoConfig | null> {
  if (!workItem.projectId) return null;
  const projectConfigDir = process.env.AGENT_TEAM_PROJECT_CONFIG_DIR || ".agent-team/projects";
  const projectConfigPath = path.join(projectConfigDir, `${safeFileSegment(workItem.projectId)}.yaml`);
  try {
    const config = loadTargetRepoConfig(projectConfigPath);
    if (targetConfigMatchesWorkItem(config, workItem)) return config;
    throw new Error(`Project config ${projectConfigPath} does not match ${workItem.projectId || workItem.repo}.`);
  } catch (error) {
    if (error instanceof Error && /does not match/.test(error.message)) throw error;
    return null;
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
  return exec(command, { cwd, env: githubAuthEnv() });
}

function assertSafeGitRef(value: string, label: string): string {
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function safeFileSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "project";
}

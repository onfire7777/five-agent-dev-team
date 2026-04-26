import type { AgentDefinition } from "./definitions";
import type { MemoryRecord, StageArtifact, WorkItem, WorkItemState } from "../../shared/src";
import { buildSharedContext, DEFAULT_SCHEDULER_POLICY, formatSharedContext, shouldUseLiveApi, StageArtifactSchema } from "../../shared/src";

export interface AgentRunContext {
  workItem: WorkItem;
  stage: WorkItemState;
  previousArtifacts: StageArtifact[];
  memories?: MemoryRecord[];
  input?: string;
}

export interface AgentRunResult {
  artifact: StageArtifact;
  rawOutput: string;
  live: boolean;
}

export async function runRoleAgent(definition: AgentDefinition, context: AgentRunContext): Promise<AgentRunResult> {
  const policy = {
    ...DEFAULT_SCHEDULER_POLICY,
    mode: (process.env.AGENT_EXECUTION_MODE as any) || DEFAULT_SCHEDULER_POLICY.mode
  };

  if ((process.env.AGENT_LIVE_MODE === "true" || shouldUseLiveApi(policy)) && process.env.OPENAI_API_KEY) {
    return runLiveOpenAIAgent(definition, context);
  }

  const artifact = createTemplateArtifact(definition, context);
  return { artifact, rawOutput: artifact.summary, live: false };
}

async function runLiveOpenAIAgent(definition: AgentDefinition, context: AgentRunContext): Promise<AgentRunResult> {
  const sdk = await import("@openai/agents");
  const AgentCtor = (sdk as any).Agent;
  const run = (sdk as any).run;
  const agent = new AgentCtor({
    name: definition.displayName,
    instructions: definition.instructions
  });

  const result = await run(agent, buildAgentPrompt(definition, context));
  const rawOutput = String(result?.finalOutput ?? result?.output ?? result ?? "");
  const artifact = createTemplateArtifact(definition, context, rawOutput);
  return { artifact, rawOutput, live: true };
}

function buildAgentPrompt(definition: AgentDefinition, context: AgentRunContext): string {
  const sharedContext = buildSharedContext(context.workItem, context.previousArtifacts, context.memories || []);
  return [
    `Work item: ${context.workItem.id} - ${context.workItem.title}`,
    `Stage: ${context.stage}`,
    `Agent: ${definition.displayName}`,
    "",
    "Shared team context:",
    formatSharedContext(sharedContext),
    "",
    `Acceptance criteria: ${context.workItem.acceptanceCriteria.join("; ") || "Not provided"}`,
    `Previous artifacts: ${context.previousArtifacts.map((artifact) => `${artifact.stage}: ${artifact.summary}`).join(" | ") || "None"}`,
    "Cooperate with the team: reference teammate activity, preserve prior decisions, update shared risks, and return a concise stage artifact covering decisions, risks, tests, release readiness, and next stage."
  ].join("\n");
}

function createTemplateArtifact(
  definition: AgentDefinition,
  context: AgentRunContext,
  liveSummary?: string
): StageArtifact {
  const nextStage = inferNextStage(context.stage, context.workItem);
  const status = context.stage === "BLOCKED" ? "blocked" : "passed";
  const artifact = {
    workItemId: context.workItem.id,
    stage: context.stage,
    ownerAgent: definition.role,
    status,
    title: `${definition.shortName} artifact for ${context.stage}`,
    summary: liveSummary?.trim() || templateSummary(definition, context),
    decisions: templateDecisions(definition, context),
    risks: templateRisks(context),
    filesChanged: [],
    testsRun: context.stage === "VERIFY" || context.stage === "RELEASE" ? ["configured local checks", "GitHub Actions gate"] : [],
    releaseReadiness: context.stage === "RELEASE" ? "ready" : "unknown",
    nextStage,
    createdAt: new Date().toISOString()
  };
  return StageArtifactSchema.parse(artifact);
}

function inferNextStage(stage: WorkItemState, workItem: WorkItem): WorkItemState | null {
  if (stage === "INTAKE") return workItem.rndNeeded ? "RND" : "CONTRACT";
  if (stage === "RND") return "CONTRACT";
  if (stage === "CONTRACT") {
    if (workItem.frontendNeeded) return "FRONTEND_BUILD";
    if (workItem.backendNeeded) return "BACKEND_BUILD";
    return "VERIFY";
  }
  if (stage === "FRONTEND_BUILD" && workItem.backendNeeded) return "BACKEND_BUILD";
  if (stage === "BACKEND_BUILD" || stage === "FRONTEND_BUILD") return "INTEGRATION";
  if (stage === "INTEGRATION") return "VERIFY";
  if (stage === "VERIFY") return "RELEASE";
  if (stage === "RELEASE") return "CLOSED";
  if (stage === "CLOSED") return null;
  return "INTAKE";
}

function templateSummary(definition: AgentDefinition, context: AgentRunContext): string {
  const teammateCount = context.previousArtifacts.length;
  const criteria = context.workItem.acceptanceCriteria.length
    ? ` Acceptance criteria covered: ${context.workItem.acceptanceCriteria.join("; ")}.`
    : "";
  return `${definition.displayName} completed ${context.stage} for ${context.workItem.title} with awareness of ${teammateCount} teammate artifact(s).${criteria}`;
}

function templateDecisions(definition: AgentDefinition, context: AgentRunContext): string[] {
  if (definition.role === "product-delivery-orchestrator") {
    return [`Route ${context.workItem.id} through ${context.workItem.rndNeeded ? "R&D" : "direct build"} before verification.`];
  }
  if (definition.role === "rnd-architecture-innovation") {
    return ["Use a locked frontend/backend contract before parallel implementation."];
  }
  if (definition.role === "frontend-ux-engineering") {
    return ["Implement visible UI states, accessible controls, and responsive behavior against the contract."];
  }
  if (definition.role === "backend-systems-engineering") {
    return ["Implement APIs, data behavior, observability, and backend tests against the contract."];
  }
  return ["Release can proceed only when local checks, GitHub Actions, security, privacy, rollback, and sync gates pass."];
}

function templateRisks(context: AgentRunContext): string[] {
  if (context.workItem.riskLevel === "high") {
    return ["High-risk work requires every autonomous release gate to pass."];
  }
  if (context.workItem.requestType === "security" || context.workItem.requestType === "privacy") {
    return ["Security/privacy work requires independent verification before release."];
  }
  return [];
}

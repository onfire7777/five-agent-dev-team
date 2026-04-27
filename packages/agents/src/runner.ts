import type { AgentDefinition } from "./definitions";
import type {
  McpServerConfig,
  MemoryRecord,
  StageArtifact,
  TargetRepoConfig,
  WorkItem,
  WorkItemState
} from "../../shared/src";
import { assembleCanonicalPrompt } from "./prompt";
import { loadTriggeredSkills, type LoadedSkill } from "./skills";
import {
  DEFAULT_SCHEDULER_POLICY,
  githubToken,
  shouldActivateCapability,
  shouldUseLiveApi,
  StageArtifactSchema
} from "../../shared/src";

export interface TeamBusMessage {
  createdAt?: string;
  stage?: WorkItemState;
  ownerAgent?: string;
  type?: string;
  message: string;
}

export interface AgentRunContext {
  workItem: WorkItem;
  stage: WorkItemState;
  previousArtifacts: StageArtifact[];
  memories?: MemoryRecord[];
  targetRepoConfig?: TargetRepoConfig;
  input?: string;
  proposalStage?: boolean;
  teamMessages?: TeamBusMessage[];
  teamDirection?: string[];
  loopContext?: string[];
}

export interface AgentRunResult {
  artifact: StageArtifact;
  rawOutput: string;
  live: boolean;
}

type AgentRunPreparation = {
  prompt: string;
  promptHash: string;
  skills: LoadedSkill[];
  droppedSkillIds: string[];
  capabilityIds: string[];
};

export async function runRoleAgent(definition: AgentDefinition, context: AgentRunContext): Promise<AgentRunResult> {
  const policy = {
    ...DEFAULT_SCHEDULER_POLICY,
    mode: (process.env.AGENT_EXECUTION_MODE as any) || DEFAULT_SCHEDULER_POLICY.mode
  };
  const preparation = await prepareAgentRun(definition, context);

  if ((process.env.AGENT_LIVE_MODE === "true" || shouldUseLiveApi(policy)) && process.env.OPENAI_API_KEY) {
    return runLiveOpenAIAgent(definition, context, preparation);
  }

  const artifact = createTemplateArtifact(definition, context, preparation);
  return { artifact, rawOutput: artifact.summary, live: false };
}

async function prepareAgentRun(
  definition: AgentDefinition,
  context: AgentRunContext,
  selectedModelOverride?: string
): Promise<AgentRunPreparation> {
  const selectedModel = selectedModelOverride || modelForAgent(definition, context.targetRepoConfig);
  const skillLoad = await loadTriggeredSkills({
    workItem: context.workItem,
    stage: context.stage,
    agent: definition.role,
    targetRepoConfig: context.targetRepoConfig
  });
  const capabilityIds = activeCapabilityIds(definition, context);
  const prompt = assembleCanonicalPrompt({
    definition,
    workItem: context.workItem,
    stage: context.stage,
    selectedModel,
    previousArtifacts: context.previousArtifacts,
    memories: context.memories || [],
    skills: skillLoad.skills,
    droppedSkillIds: skillLoad.droppedSkillIds,
    capabilityIds,
    targetRepoConfig: context.targetRepoConfig,
    proposalStage: context.proposalStage,
    teamMessages: context.teamMessages,
    teamDirection: context.teamDirection,
    loopContext: context.loopContext
  });
  return {
    prompt: prompt.prompt,
    promptHash: prompt.promptHash,
    skills: skillLoad.skills,
    droppedSkillIds: skillLoad.droppedSkillIds,
    capabilityIds
  };
}

async function runLiveOpenAIAgent(
  definition: AgentDefinition,
  context: AgentRunContext,
  preparation: AgentRunPreparation
): Promise<AgentRunResult> {
  const sdk = await import("@openai/agents");
  const primaryModel = modelForAgent(definition, context.targetRepoConfig);
  const fallbackModel = fallbackModelForAgent(context.targetRepoConfig);
  try {
    return await runLiveOpenAIAgentWithModel(sdk, definition, context, primaryModel, preparation);
  } catch (error) {
    if (!fallbackModel || fallbackModel === primaryModel) throw error;
    try {
      const fallbackPreparation = await prepareAgentRun(definition, context, fallbackModel);
      const fallbackResult = await runLiveOpenAIAgentWithModel(
        sdk,
        definition,
        context,
        fallbackModel,
        fallbackPreparation
      );
      return {
        ...fallbackResult,
        rawOutput: `Primary model ${primaryModel} failed; fallback ${fallbackModel} succeeded.\n${fallbackResult.rawOutput}`
      };
    } catch {
      throw error;
    }
  }
}

async function runLiveOpenAIAgentWithModel(
  sdk: any,
  definition: AgentDefinition,
  context: AgentRunContext,
  model: string,
  preparation: AgentRunPreparation
): Promise<AgentRunResult> {
  const AgentCtor = (sdk as any).Agent;
  const run = (sdk as any).run;
  const mcpServers = createConfiguredMcpServers(sdk, definition, context);
  const tools = createHostedTools(sdk, definition, context);
  const mcpSession = mcpServers.length
    ? await sdk.MCPServers.open(mcpServers, {
        connectTimeoutMs: Number(process.env.AGENT_MCP_CONNECT_TIMEOUT_MS || 10_000),
        closeTimeoutMs: Number(process.env.AGENT_MCP_CLOSE_TIMEOUT_MS || 5_000),
        connectInParallel: true,
        dropFailed: true,
        strict: /^(1|true|yes)$/i.test(process.env.AGENT_MCP_STRICT || "")
      })
    : null;

  try {
    const agent = new AgentCtor({
      name: definition.displayName,
      instructions: definition.instructions,
      model,
      mcpServers: mcpSession?.active || [],
      tools
    });

    const result = await run(agent, preparation.prompt);
    const rawOutput = String(result?.finalOutput ?? result?.output ?? result ?? "");
    const artifact =
      parseLiveArtifact(definition, context, rawOutput, preparation) ||
      createInvalidLiveArtifact(definition, context, rawOutput, preparation);
    return { artifact, rawOutput, live: true };
  } finally {
    await mcpSession?.close();
  }
}

function modelForAgent(definition: AgentDefinition, config?: TargetRepoConfig): string {
  if (process.env.AGENT_MODEL) return process.env.AGENT_MODEL;
  if (!config) return "gpt-5.5";
  if (definition.role === "rnd-architecture-innovation") return config.models.researchModel;
  if (definition.role === "quality-security-privacy-release") return config.models.reviewModel;
  return config.models.primaryCodingModel;
}

function fallbackModelForAgent(config?: TargetRepoConfig): string | null {
  if (process.env.AGENT_MODEL || !config || !config.models.useBestAvailable) return null;
  return config.models.fallbackModel;
}

function createConfiguredMcpServers(sdk: any, definition: AgentDefinition, context: AgentRunContext): any[] {
  if (!context.targetRepoConfig) return [];
  return context.targetRepoConfig.integrations.mcpServers
    .filter((server) =>
      shouldActivateCapability(server.enabled, server.activation, {
        workItem: context.workItem,
        stage: context.stage,
        agent: definition.role
      })
    )
    .map((server) => createMcpServer(sdk, server));
}

function createHostedTools(sdk: any, definition: AgentDefinition, context: AgentRunContext): any[] {
  if (!shouldUseHostedWebSearch(definition, context) || typeof sdk.webSearchTool !== "function") return [];
  return [
    sdk.webSearchTool({
      searchContextSize: "medium"
    })
  ];
}

function shouldUseHostedWebSearch(definition: AgentDefinition, context: AgentRunContext): boolean {
  if (!context.targetRepoConfig) return false;
  const input = {
    workItem: context.workItem,
    stage: context.stage,
    agent: definition.role
  };
  return context.targetRepoConfig.integrations.capabilityPacks.some(
    (pack) => pack.name === "hosted-search" && shouldActivateCapability(pack.enabled, pack.activation, input)
  );
}

function activeCapabilityIds(definition: AgentDefinition, context: AgentRunContext): string[] {
  if (!context.targetRepoConfig) return [];
  const input = {
    workItem: context.workItem,
    stage: context.stage,
    agent: definition.role
  };
  return [
    ...context.targetRepoConfig.integrations.mcpServers
      .filter((server) => shouldActivateCapability(server.enabled, server.activation, input))
      .map((server) => `mcp:${server.name}`),
    ...context.targetRepoConfig.integrations.capabilityPacks
      .filter((pack) => shouldActivateCapability(pack.enabled, pack.activation, input))
      .map((pack) => `${pack.kind}:${pack.name}`)
  ];
}

function createMcpServer(sdk: any, server: McpServerConfig): any {
  const toolFilter = server.toolAllowlist.length
    ? sdk.createMCPToolStaticFilter({ allowed: server.toolAllowlist })
    : undefined;
  const common = {
    name: server.name,
    cwd: server.cwd,
    env: Object.keys(server.env).length ? { ...process.env, ...resolveMcpEnv(server.env) } : undefined,
    cacheToolsList: server.cacheToolsList,
    clientSessionTimeoutSeconds: server.timeoutSeconds,
    toolFilter,
    errorFunction: () => `MCP server ${server.name} failed. Check sanitized controller and MCP logs before retrying.`
  };

  if (server.transport === "stdio") {
    return new sdk.MCPServerStdio({
      ...common,
      command: server.command,
      args: server.args
    });
  }

  return new sdk.MCPServerStreamableHttp({
    ...common,
    url: server.url
  });
}

export function resolveMcpEnv(env: Record<string, string>): Record<string, string> {
  const resolved = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => process.env[name] || "")
    ])
  );

  if ("GITHUB_PERSONAL_ACCESS_TOKEN" in resolved && !resolved.GITHUB_PERSONAL_ACCESS_TOKEN) {
    resolved.GITHUB_PERSONAL_ACCESS_TOKEN = githubToken();
  }
  if ("GH_TOKEN" in resolved && !resolved.GH_TOKEN) {
    resolved.GH_TOKEN = githubToken();
  }
  if ("GITHUB_TOKEN" in resolved && !resolved.GITHUB_TOKEN) {
    resolved.GITHUB_TOKEN = githubToken();
  }

  return resolved;
}

function parseLiveArtifact(
  definition: AgentDefinition,
  context: AgentRunContext,
  rawOutput: string,
  preparation: AgentRunPreparation
): StageArtifact | null {
  const parsed = parseJsonObject(rawOutput);
  if (!parsed || typeof parsed !== "object") return null;

  const candidate = {
    ...(parsed as Record<string, unknown>),
    workItemId: context.workItem.id,
    projectId: context.workItem.projectId,
    repo: context.workItem.repo,
    stage: context.stage,
    ownerAgent: definition.role,
    promptHash: preparation.promptHash,
    skillIds: preparation.skills.map((skill) => skill.id),
    capabilityIds: preparation.capabilityIds,
    createdAt: String((parsed as any).createdAt || new Date().toISOString())
  };

  const result = StageArtifactSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

function parseJsonObject(rawOutput: string): unknown {
  const fenced = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || rawOutput;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function createTemplateArtifact(
  definition: AgentDefinition,
  context: AgentRunContext,
  preparation: AgentRunPreparation,
  liveSummary?: string
): StageArtifact {
  const nextStage = inferNextStage(context.stage, context.workItem);
  const status = context.stage === "BLOCKED" ? "blocked" : "passed";
  const artifact = {
    workItemId: context.workItem.id,
    projectId: context.workItem.projectId,
    repo: context.workItem.repo,
    stage: context.stage,
    ownerAgent: definition.role,
    status,
    title: context.proposalStage
      ? `${definition.shortName} proposal for ${context.stage}`
      : `${definition.shortName} artifact for ${context.stage}`,
    summary: liveSummary?.trim() || templateSummary(definition, context),
    decisions: templateDecisions(definition, context),
    risks: templateRisks(context),
    filesChanged: [],
    testsRun: [],
    releaseReadiness: "unknown",
    nextStage,
    promptHash: preparation.promptHash,
    skillIds: preparation.skills.map((skill) => skill.id),
    capabilityIds: preparation.capabilityIds,
    createdAt: new Date().toISOString()
  };
  return StageArtifactSchema.parse(artifact);
}

function createInvalidLiveArtifact(
  definition: AgentDefinition,
  context: AgentRunContext,
  rawOutput: string,
  preparation: AgentRunPreparation
): StageArtifact {
  return StageArtifactSchema.parse({
    workItemId: context.workItem.id,
    projectId: context.workItem.projectId,
    repo: context.workItem.repo,
    stage: context.stage,
    ownerAgent: definition.role,
    status: "failed",
    title: `${definition.shortName} returned invalid output for ${context.stage}`,
    summary: `Live agent output could not be parsed into a valid stage artifact. The workflow is blocked so invalid or incomplete agent output cannot advance implementation.`,
    decisions: ["Block this stage until the agent returns valid JSON matching the StageArtifact schema."],
    risks: [
      rawOutput.trim()
        ? "Invalid live output was omitted from the artifact to avoid persisting untrusted content."
        : "Live agent returned empty output."
    ],
    filesChanged: [],
    testsRun: [],
    releaseReadiness: "not_ready",
    nextStage: "BLOCKED",
    promptHash: preparation.promptHash,
    skillIds: preparation.skills.map((skill) => skill.id),
    capabilityIds: preparation.capabilityIds,
    createdAt: new Date().toISOString()
  });
}

function inferNextStage(stage: WorkItemState, workItem: WorkItem): WorkItemState | null {
  if (stage === "INTAKE") return workItem.rndNeeded ? "RND" : "CONTRACT";
  if (stage === "RND") return "PROPOSAL";
  if (stage === "PROPOSAL") return "AWAITING_ACCEPTANCE";
  if (stage === "AWAITING_ACCEPTANCE") return "CONTRACT";
  if (stage === "CONTRACT") {
    if (workItem.frontendNeeded) return "FRONTEND_BUILD";
    if (workItem.backendNeeded) return "BACKEND_BUILD";
    return "INTEGRATION";
  }
  if (stage === "FRONTEND_BUILD" && workItem.backendNeeded) return "BACKEND_BUILD";
  if (stage === "BACKEND_BUILD" || stage === "FRONTEND_BUILD") return "INTEGRATION";
  if (stage === "INTEGRATION") return "VERIFY";
  if (stage === "VERIFY") return "RELEASE";
  if (stage === "RELEASE") return "CLOSED";
  if (stage === "CLOSED") return null;
  if (stage === "BLOCKED") return null;
  return "INTAKE";
}

function templateSummary(definition: AgentDefinition, context: AgentRunContext): string {
  const teammateCount = context.previousArtifacts.length;
  const memoryCount = context.memories?.length || 0;
  const teamMessageCount = context.teamMessages?.length || 0;
  const criteria = context.workItem.acceptanceCriteria.length
    ? ` Acceptance criteria covered: ${context.workItem.acceptanceCriteria.join("; ")}.`
    : "";
  if (context.proposalStage) {
    return `${definition.displayName} proposed the ${context.stage} handoff for ${context.workItem.title} with ${teammateCount} teammate artifact(s), ${teamMessageCount} team bus message(s), and ${memoryCount} durable memory record(s).${criteria}`;
  }
  return `${definition.displayName} completed ${context.stage} for ${context.workItem.title} with awareness of ${teammateCount} teammate artifact(s) and ${memoryCount} durable memory record(s).${criteria}`;
}

function templateDecisions(definition: AgentDefinition, context: AgentRunContext): string[] {
  if (definition.role === "product-delivery-orchestrator") {
    return [
      `Route ${context.workItem.id} through ${context.workItem.rndNeeded ? "R&D" : "direct build"} before verification.`
    ];
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
  return [
    "Release can proceed only when local checks, GitHub Actions, security, privacy, rollback, and sync gates pass."
  ];
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

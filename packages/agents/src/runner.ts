import type { AgentDefinition } from "./definitions";
import type { McpServerConfig, MemoryRecord, StageArtifact, TargetRepoConfig, WorkItem, WorkItemState } from "../../shared/src";
import {
  buildSharedContext,
  DEFAULT_SCHEDULER_POLICY,
  formatSharedContext,
  shouldActivateCapability,
  shouldUseLiveApi,
  StageArtifactSchema
} from "../../shared/src";

export interface AgentRunContext {
  workItem: WorkItem;
  stage: WorkItemState;
  previousArtifacts: StageArtifact[];
  memories?: MemoryRecord[];
  targetRepoConfig?: TargetRepoConfig;
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
  const primaryModel = modelForAgent(definition, context.targetRepoConfig);
  const fallbackModel = fallbackModelForAgent(context.targetRepoConfig);
  try {
    return await runLiveOpenAIAgentWithModel(sdk, definition, context, primaryModel);
  } catch (error) {
    if (!fallbackModel || fallbackModel === primaryModel) throw error;
    try {
      const fallbackResult = await runLiveOpenAIAgentWithModel(sdk, definition, context, fallbackModel);
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
  model: string
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

    const result = await run(agent, buildAgentPrompt(definition, context, model));
    const rawOutput = String(result?.finalOutput ?? result?.output ?? result ?? "");
    const artifact = parseLiveArtifact(definition, context, rawOutput) || createTemplateArtifact(definition, context, rawOutput);
    return { artifact, rawOutput, live: true };
  } finally {
    await mcpSession?.close();
  }
}

function buildAgentPrompt(definition: AgentDefinition, context: AgentRunContext, selectedModel = modelForAgent(definition, context.targetRepoConfig)): string {
  const sharedContext = buildSharedContext(context.workItem, context.previousArtifacts, context.memories || [], {
    targetRepoConfig: context.targetRepoConfig,
    stage: context.stage,
    agent: definition.role
  });
  return [
    `Work item: ${context.workItem.id} - ${context.workItem.title}`,
    `Stage: ${context.stage}`,
    `Agent: ${definition.displayName}`,
    `Project scope: ${context.workItem.projectId || (context.targetRepoConfig ? "configured repo" : "unscoped")}`,
    `Repository scope: ${context.workItem.repo || "not connected"}`,
    `Model policy: ${selectedModel} selected for this run, with configured fallback only if unavailable.`,
    "",
    "Shared team context:",
    formatSharedContext(sharedContext),
    "",
    `Acceptance criteria: ${context.workItem.acceptanceCriteria.join("; ") || "Not provided"}`,
    `Previous artifacts: ${context.previousArtifacts.map((artifact) => `${artifact.stage}: ${artifact.summary}`).join(" | ") || "None"}`,
    "Capability rule: proactively use active MCP tools, skills, plugins, and knowledge packs when they materially improve this stage; do not call inactive or irrelevant tools.",
    "Research rule: use hosted web search or web-search MCP only for current external facts that local repo context cannot prove; summarize sources into decisions, risks, tests, or follow-ups.",
    "When a tool uncovers a durable lesson, convert it into an artifact decision, risk, test, or follow-up rather than relying on transient tool output.",
    "Cooperate with the team: reference teammate activity, preserve prior decisions, update shared risks, and return only JSON for one stage artifact.",
    "The JSON must include title, summary, status, decisions, risks, filesChanged, testsRun, releaseReadiness, and nextStage."
  ].join("\n");
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
    .filter((server) => shouldActivateCapability(server.enabled, server.activation, {
      workItem: context.workItem,
      stage: context.stage,
      agent: definition.role
    }))
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
  return context.targetRepoConfig.integrations.capabilityPacks.some((pack) =>
    pack.name === "deep-web-research" && shouldActivateCapability(pack.enabled, pack.activation, input)
  ) || context.targetRepoConfig.integrations.mcpServers.some((server) =>
    server.category === "web_search" && shouldActivateCapability(server.enabled, server.activation, input)
  );
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
  const resolved = Object.fromEntries(Object.entries(env).map(([key, value]) => [
    key,
    value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => process.env[name] || "")
  ]));

  if ("GITHUB_PERSONAL_ACCESS_TOKEN" in resolved && !resolved.GITHUB_PERSONAL_ACCESS_TOKEN) {
    resolved.GITHUB_PERSONAL_ACCESS_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  }
  if ("GH_TOKEN" in resolved && !resolved.GH_TOKEN) {
    resolved.GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "";
  }
  if ("GITHUB_TOKEN" in resolved && !resolved.GITHUB_TOKEN) {
    resolved.GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "";
  }

  return resolved;
}

function parseLiveArtifact(
  definition: AgentDefinition,
  context: AgentRunContext,
  rawOutput: string
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
  const criteria = context.workItem.acceptanceCriteria.length
    ? ` Acceptance criteria covered: ${context.workItem.acceptanceCriteria.join("; ")}.`
    : "";
  return `${definition.displayName} completed ${context.stage} for ${context.workItem.title} with awareness of ${teammateCount} teammate artifact(s) and ${memoryCount} durable memory record(s).${criteria}`;
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

import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AgentDefinition } from "./definitions";
import type {
  AgentEvent,
  McpServerConfig,
  MemoryRecord,
  StageArtifact,
  TargetRepoConfig,
  WorkItem,
  WorkItemState
} from "../../shared/src";
import { assembleCanonicalPrompt } from "./prompt";
import { loadSkillById, loadTriggeredSkills, type LoadedSkill } from "./skills";
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

export type AgentToolEventInput = {
  level: AgentEvent["level"];
  type: AgentEvent["type"] | "agent.blocked";
  message: string;
};

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
  emitEvent?: (event: AgentToolEventInput) => Promise<void>;
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

type ConfiguredMcpServer = {
  id: string;
  server: any;
};

type ConfiguredHostedTool = {
  id: string;
  tool: any;
};

const BUILT_IN_TOOL_IDS = [
  "builtin:memory.search",
  "builtin:repo.context.read",
  "builtin:artifact.write",
  "builtin:event.emit",
  "builtin:skill.load"
];
const MAX_MEMORY_RESULTS = 10;
const DEFAULT_MEMORY_RESULTS = 5;
const MAX_CONTEXT_FILES = 20;
const MAX_CONTEXT_FILE_BYTES = 12_000;

const MemorySearchInputSchema = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(MAX_MEMORY_RESULTS).default(DEFAULT_MEMORY_RESULTS)
});
const RepoContextReadInputSchema = z.object({
  path: z.string().trim().optional()
});
const ArtifactWriteInputSchema = z.object({}).passthrough();
const EventEmitInputSchema = z.object({
  level: z.enum(["info", "warn", "error"]).default("info"),
  type: z
    .enum([
      "workflow_claimed",
      "stage_started",
      "stage_completed",
      "stage_failed",
      "verification",
      "release",
      "scheduler",
      "system",
      "agent.blocked"
    ])
    .default("system"),
  message: z.string().trim().min(1).max(2_000)
});
const SkillLoadInputSchema = z.object({
  id: z.string().trim().min(1)
});

export async function runRoleAgent(definition: AgentDefinition, context: AgentRunContext): Promise<AgentRunResult> {
  const policy = {
    ...DEFAULT_SCHEDULER_POLICY,
    mode: (process.env.AGENT_EXECUTION_MODE as any) || DEFAULT_SCHEDULER_POLICY.mode
  };
  const preparation = await prepareAgentRun(definition, context);

  if ((process.env.AGENT_LIVE_MODE === "true" || shouldUseLiveApi(policy)) && process.env.OPENAI_API_KEY) {
    return runLiveOpenAIAgent(definition, context);
  }

  const artifact = createTemplateArtifact(definition, context, preparation);
  return { artifact, rawOutput: artifact.summary, live: false };
}

async function prepareAgentRun(
  definition: AgentDefinition,
  context: AgentRunContext,
  selectedModelOverride?: string,
  capabilityIdsOverride?: string[]
): Promise<AgentRunPreparation> {
  const selectedModel = selectedModelOverride || modelForAgent(definition, context.targetRepoConfig);
  const skillLoad = await loadTriggeredSkills({
    workItem: context.workItem,
    stage: context.stage,
    agent: definition.role,
    targetRepoConfig: context.targetRepoConfig
  });
  const capabilityIds = capabilityIdsOverride || activeCapabilityIds(definition, context);
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
  const configuredMcpServers = createConfiguredMcpServers(sdk, definition, context);
  const hostedTools = createHostedTools(sdk, definition, context);
  const mcpSession = configuredMcpServers.length
    ? await sdk.MCPServers.open(
        configuredMcpServers.map(({ server }) => server),
        {
          connectTimeoutMs: Number(process.env.AGENT_MCP_CONNECT_TIMEOUT_MS || 10_000),
          closeTimeoutMs: Number(process.env.AGENT_MCP_CLOSE_TIMEOUT_MS || 5_000),
          connectInParallel: true,
          dropFailed: true,
          strict: /^(1|true|yes)$/i.test(process.env.AGENT_MCP_STRICT || "")
        }
      )
    : null;
  const builtInCapabilityIds = canRegisterBuiltInTools(sdk) ? BUILT_IN_TOOL_IDS : [];
  const capabilityIds = runtimeCapabilityIds(
    configuredMcpServers,
    mcpSession?.active || [],
    hostedTools,
    builtInCapabilityIds
  );
  const preparation = await prepareAgentRun(definition, context, model, capabilityIds);
  const artifactCapture: { artifact: StageArtifact | null } = { artifact: null };
  const builtInTools = createBuiltInTools(sdk, definition, context, preparation, artifactCapture);

  try {
    const agent = new AgentCtor({
      name: definition.displayName,
      instructions: definition.instructions,
      model,
      mcpServers: mcpSession?.active || [],
      tools: [...hostedTools.map(({ tool }) => tool), ...builtInTools.map(({ tool }) => tool)]
    });

    const result = await run(agent, preparation.prompt);
    const rawOutput = String(result?.finalOutput ?? result?.output ?? result ?? "");
    const artifact =
      artifactCapture.artifact ||
      parseLiveArtifact(definition, context, rawOutput, preparation) ||
      createInvalidLiveArtifact(definition, context, rawOutput, preparation);
    return { artifact, rawOutput, live: true };
  } finally {
    try {
      await mcpSession?.close();
    } catch {
      process.emitWarning("MCP session close failed; preserving completed agent result.", {
        code: "AGENT_MCP_CLOSE_FAILED"
      });
    }
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

function createConfiguredMcpServers(
  sdk: any,
  definition: AgentDefinition,
  context: AgentRunContext
): ConfiguredMcpServer[] {
  if (!context.targetRepoConfig) return [];
  return context.targetRepoConfig.integrations.mcpServers
    .filter((server) =>
      shouldActivateCapability(server.enabled, server.activation, {
        workItem: context.workItem,
        stage: context.stage,
        agent: definition.role
      })
    )
    .map((server) => ({
      id: `mcp:${server.name}`,
      server: createMcpServer(sdk, server)
    }));
}

function createHostedTools(sdk: any, definition: AgentDefinition, context: AgentRunContext): ConfiguredHostedTool[] {
  if (!shouldUseHostedWebSearch(definition, context) || typeof sdk.webSearchTool !== "function") return [];
  return [
    {
      id: "hosted:hosted-search",
      tool: sdk.webSearchTool({
        searchContextSize: "medium"
      })
    }
  ];
}

function canRegisterBuiltInTools(sdk: any): boolean {
  return typeof sdk.tool === "function" && typeof sdk.toolNamespace === "function";
}

function createBuiltInTools(
  sdk: any,
  definition: AgentDefinition,
  context: AgentRunContext,
  preparation: AgentRunPreparation,
  artifactCapture: { artifact: StageArtifact | null }
): ConfiguredHostedTool[] {
  if (!canRegisterBuiltInTools(sdk)) return [];

  const memorySearch = sdk.tool({
    name: "search",
    description: "Search scoped durable memory from the current project, repository, work item, or agent.",
    parameters: MemorySearchInputSchema,
    execute: async (input: unknown) => searchScopedMemories(context, definition, input)
  });
  const repoContextRead = sdk.tool({
    name: "read",
    description: "Read files from the configured repo context directory only.",
    parameters: RepoContextReadInputSchema,
    execute: async (input: unknown) => readRepoContext(context, input)
  });
  const artifactWrite = sdk.tool({
    name: "write",
    description: "Validate and capture exactly one StageArtifact for this run.",
    parameters: ArtifactWriteInputSchema,
    execute: async (input: unknown) => writeStageArtifact(definition, context, preparation, artifactCapture, input)
  });
  const eventEmit = sdk.tool({
    name: "emit",
    description: "Emit a scoped workflow event through the current activity handler.",
    parameters: EventEmitInputSchema,
    execute: async (input: unknown) => emitScopedEvent(context, input)
  });
  const skillLoad = sdk.tool({
    name: "load",
    description: "Load one skill by id when it is allowed for the current agent role.",
    parameters: SkillLoadInputSchema,
    execute: async (input: unknown) => loadAllowedSkill(definition, context, input)
  });

  return [
    ...namespaceTool(sdk, "memory", "Project, repository, work-item, and agent-scoped memory tools.", [
      { id: "builtin:memory.search", tool: memorySearch }
    ]),
    ...namespaceTool(sdk, "repo_context", "Curated connected-repository context tools.", [
      { id: "builtin:repo.context.read", tool: repoContextRead }
    ]),
    ...namespaceTool(sdk, "artifact", "Validated stage artifact tools.", [
      { id: "builtin:artifact.write", tool: artifactWrite }
    ]),
    ...namespaceTool(sdk, "event", "Scoped workflow event tools.", [{ id: "builtin:event.emit", tool: eventEmit }]),
    ...namespaceTool(sdk, "skill", "Audience-checked skill loading tools.", [
      { id: "builtin:skill.load", tool: skillLoad }
    ])
  ];
}

function namespaceTool(
  sdk: any,
  name: string,
  description: string,
  tools: ConfiguredHostedTool[]
): ConfiguredHostedTool[] {
  const namespaced = sdk.toolNamespace({
    name,
    description,
    tools: tools.map(({ tool }) => tool)
  });
  return tools.map(({ id }, index) => ({ id, tool: namespaced[index] }));
}

function searchScopedMemories(context: AgentRunContext, definition: AgentDefinition, input: unknown) {
  const { query, limit } = MemorySearchInputSchema.parse(input);
  const needle = query.trim().toLowerCase();
  const records = (context.memories || [])
    .filter((memory) => memoryMatchesScope(memory, context.workItem, definition))
    .filter((memory) => {
      if (!needle) return true;
      return [memory.title, memory.content, memory.kind, memory.key, ...(memory.tags || [])]
        .filter(Boolean)
        .join("\n")
        .toLowerCase()
        .includes(needle);
    })
    .sort((a, b) => b.importance - a.importance || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map((memory) => ({
      id: memory.id,
      scope: memory.scope,
      kind: memory.kind,
      title: memory.title,
      content: memory.content.slice(0, 2_000),
      tags: memory.tags,
      confidence: memory.confidence,
      importance: memory.importance,
      updatedAt: memory.updatedAt
    }));

  return {
    query,
    limit,
    count: records.length,
    records
  };
}

function memoryMatchesScope(memory: MemoryRecord, workItem: WorkItem, definition: AgentDefinition): boolean {
  if (memory.projectId && memory.projectId !== workItem.projectId) return false;
  if (memory.repo && memory.repo !== workItem.repo) return false;
  if (memory.workItemId && memory.workItemId !== workItem.id) return false;
  if (memory.agent && memory.agent !== definition.role) return false;

  if (memory.scope === "work_item") return memory.workItemId === workItem.id;
  if (memory.scope === "repo") return Boolean(workItem.repo && memory.repo === workItem.repo);
  if (memory.scope === "agent") return memory.agent === definition.role;
  return false;
}

async function readRepoContext(
  context: AgentRunContext,
  input: unknown
): Promise<{
  root: string;
  files?: string[];
  path?: string;
  content?: string;
  truncated?: boolean;
}> {
  const { path: requestedPath } = RepoContextReadInputSchema.parse(input);
  const root = repoContextRoot(context);
  if (!requestedPath) {
    return {
      root: displayRepoContextRoot(context),
      files: await listContextFiles(root)
    };
  }

  const relativePath = normalizeRequestedContextPath(context, requestedPath);
  const resolved = path.resolve(root, relativePath);
  assertInside(root, resolved, "repo.context.read path escapes the configured context directory.");
  const buffer = await readRegularContextFile(resolved);
  const truncated = buffer.byteLength > MAX_CONTEXT_FILE_BYTES;
  const content = buffer.subarray(0, MAX_CONTEXT_FILE_BYTES).toString("utf8");
  return {
    root: displayRepoContextRoot(context),
    path: toPosixPath(path.relative(root, resolved)),
    content,
    truncated
  };
}

async function readRegularContextFile(resolved: string): Promise<Buffer> {
  const handle = await fs.open(resolved, readOnlyNoFollowFlags());
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error("repo.context.read can read regular context files only.");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function writeStageArtifact(
  definition: AgentDefinition,
  context: AgentRunContext,
  preparation: AgentRunPreparation,
  artifactCapture: { artifact: StageArtifact | null },
  input: unknown
) {
  if (artifactCapture.artifact) {
    throw new Error("artifact.write was already called for this run.");
  }
  const record = normalizeRecord(input, "artifact.write");
  assertArtifactScope(record, context, definition);
  const summary =
    typeof record.summary === "string" && record.summary.trim() ? record.summary : "Stage artifact captured.";
  const bodyJson =
    typeof record.bodyJson === "object" && record.bodyJson !== null && !Array.isArray(record.bodyJson)
      ? record.bodyJson
      : record;
  const artifact = StageArtifactSchema.parse({
    ...record,
    workItemId: context.workItem.id,
    projectId: context.workItem.projectId,
    repo: context.workItem.repo,
    stage: context.stage,
    ownerAgent: definition.role,
    title:
      typeof record.title === "string" && record.title.trim()
        ? record.title
        : `${definition.shortName} artifact for ${context.stage}`,
    summary,
    nextStage:
      typeof record.nextStage === "string" || record.nextStage === null
        ? record.nextStage
        : inferNextStage(context.stage, context.workItem),
    promptHash: preparation.promptHash,
    skillIds: preparation.skills.map((skill) => skill.id),
    capabilityIds: preparation.capabilityIds,
    bodyMd:
      typeof record.bodyMd === "string" && record.bodyMd.trim()
        ? record.bodyMd
        : `## ${String(record.title || definition.shortName)}\n\n${summary}`,
    bodyJson,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString()
  });
  artifactCapture.artifact = artifact;
  return {
    status: "captured",
    artifactId: artifact.artifactId,
    workItemId: artifact.workItemId,
    stage: artifact.stage
  };
}

async function emitScopedEvent(context: AgentRunContext, input: unknown) {
  if (!context.emitEvent) {
    throw new Error("event.emit is unavailable for this agent run.");
  }
  const event = EventEmitInputSchema.parse(input);
  await context.emitEvent({
    level: event.level,
    type: event.type,
    message: event.message
  });
  return { status: "emitted", type: event.type };
}

async function loadAllowedSkill(definition: AgentDefinition, context: AgentRunContext, input: unknown) {
  const { id } = SkillLoadInputSchema.parse(input);
  const skill = await loadSkillById(
    {
      workItem: context.workItem,
      stage: context.stage,
      agent: definition.role,
      targetRepoConfig: context.targetRepoConfig
    },
    id
  );
  return {
    id: skill.id,
    name: skill.name,
    audience: skill.audience,
    priority: skill.priority,
    body: skill.body
  };
}

function normalizeRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} requires an object input.`);
  }
  return input as Record<string, unknown>;
}

function assertArtifactScope(
  record: Record<string, unknown>,
  context: AgentRunContext,
  definition: AgentDefinition
): void {
  assertScopeField(record, "workItemId", context.workItem.id);
  assertScopeField(record, "projectId", context.workItem.projectId);
  assertScopeField(record, "repo", context.workItem.repo);
  assertScopeField(record, "stage", context.stage);
  assertScopeField(record, "ownerAgent", definition.role);
}

function assertScopeField(record: Record<string, unknown>, field: string, expected: string | undefined): void {
  const actual = record[field];
  if (typeof actual === "undefined") return;
  if (!expected || String(actual) !== expected) {
    throw new Error(`artifact.write rejected mismatched ${field}.`);
  }
}

function repoContextRoot(context: AgentRunContext): string {
  const repoRoot = path.resolve(context.targetRepoConfig?.repo.localPath || process.cwd());
  const contextDir = context.targetRepoConfig?.context.defaultContextDir || ".agent-team/context";
  const root = path.resolve(repoRoot, contextDir);
  assertInside(repoRoot, root, "Configured context directory escapes the connected repository.");
  return root;
}

function displayRepoContextRoot(context: AgentRunContext): string {
  return toPosixPath(context.targetRepoConfig?.context.defaultContextDir || ".agent-team/context");
}

function normalizeRequestedContextPath(context: AgentRunContext, requestedPath: string): string {
  if (path.isAbsolute(requestedPath)) {
    throw new Error("repo.context.read requires a relative context path.");
  }
  const contextDir = toPosixPath(context.targetRepoConfig?.context.defaultContextDir || ".agent-team/context");
  let normalized = toPosixPath(requestedPath).replace(/^\/+/, "");
  if (normalized === contextDir) return "";
  if (normalized.startsWith(`${contextDir}/`)) {
    normalized = normalized.slice(contextDir.length + 1);
  }
  return normalized;
}

async function listContextFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await collectContextFiles(root, root, files);
  return files.slice(0, MAX_CONTEXT_FILES);
}

async function collectContextFiles(root: string, current: string, files: string[]): Promise<void> {
  if (files.length >= MAX_CONTEXT_FILES) return;
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= MAX_CONTEXT_FILES) return;
    const fullPath = path.join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await collectContextFiles(root, fullPath, files);
    } else if (entry.isFile()) {
      assertInside(root, fullPath, "repo.context.read found a file outside the context directory.");
      files.push(toPosixPath(path.relative(root, fullPath)));
    }
  }
}

function assertInside(root: string, candidate: string, message: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(message);
  }
}

function readOnlyNoFollowFlags(): number {
  const noFollow = (fsConstants as Record<string, number | undefined>).O_NOFOLLOW ?? 0;
  return fsConstants.O_RDONLY | noFollow;
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function runtimeCapabilityIds(
  configuredMcpServers: ConfiguredMcpServer[],
  activeMcpServers: any[],
  hostedTools: ConfiguredHostedTool[],
  builtInToolIds: string[] = []
): string[] {
  const active = new Set(activeMcpServers);
  return [
    ...configuredMcpServers.filter(({ server }) => active.has(server)).map(({ id }) => id),
    ...hostedTools.map(({ id }) => id),
    ...builtInToolIds
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
    bodyMd:
      typeof (parsed as any).bodyMd === "string"
        ? (parsed as any).bodyMd
        : `## ${String((parsed as any).title || definition.shortName)}\n\n${String((parsed as any).summary || rawOutput || "No summary returned.")}`,
    bodyJson:
      typeof (parsed as any).bodyJson === "object" && (parsed as any).bodyJson !== null
        ? (parsed as any).bodyJson
        : (parsed as Record<string, unknown>),
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
    bodyMd: `## ${liveSummary?.trim() || templateSummary(definition, context)}\n\n${templateDecisions(
      definition,
      context
    )
      .map((decision) => `- ${decision}`)
      .join("\n")}`,
    bodyJson: {
      workItemId: context.workItem.id,
      projectId: context.workItem.projectId,
      repo: context.workItem.repo,
      stage: context.stage,
      ownerAgent: definition.role,
      summary: liveSummary?.trim() || templateSummary(definition, context),
      decisions: templateDecisions(definition, context),
      risks: templateRisks(context),
      nextStage
    },
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
    bodyMd: `## Invalid live output\n\nLive agent output could not be parsed into a valid stage artifact.`,
    bodyJson: {
      workItemId: context.workItem.id,
      projectId: context.workItem.projectId,
      repo: context.workItem.repo,
      stage: context.stage,
      ownerAgent: definition.role,
      status: "failed",
      reason: "invalid-live-output"
    },
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

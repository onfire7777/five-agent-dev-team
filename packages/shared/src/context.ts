import {
  SharedContextSchema,
  type ResearchFinding,
  type MemoryRecord,
  type SharedContext,
  type StageArtifact,
  type TargetRepoConfig,
  type TeammateActivity,
  type ToolIntegrationContext,
  type WorkItem,
  type WorkItemState,
  type AgentRole,
  type CapabilityActivation
} from "./schemas";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface SharedContextOptions {
  targetRepoConfig?: TargetRepoConfig;
  stage?: WorkItemState;
  agent?: AgentRole;
}

export function buildSharedContext(
  workItem: WorkItem,
  artifacts: StageArtifact[],
  memories: MemoryRecord[] = [],
  options: SharedContextOptions = {}
): SharedContext {
  const relevant = artifacts.filter((artifact) => artifact.workItemId === workItem.id);
  const teammateActivity: TeammateActivity[] = relevant.map((artifact) => ({
    agent: artifact.ownerAgent,
    stage: artifact.stage,
    workItemId: artifact.workItemId,
    status: artifact.status,
    summary: artifact.summary,
    updatedAt: artifact.createdAt
  }));

  const artifactResearch: ResearchFinding[] = relevant
    .filter((artifact) => artifact.ownerAgent === "rnd-architecture-innovation")
    .map((artifact) => ({
      topic: artifact.title,
      source: `${artifact.ownerAgent}:${artifact.stage}`,
      summary: artifact.summary,
      confidence: artifact.status === "passed" ? "high" : "medium",
      capturedAt: artifact.createdAt
    }));
  const memoryResearch: ResearchFinding[] = memories
    .filter((memory) => memory.kind === "research" || memory.kind === "architecture")
    .map((memory) => ({
      topic: memory.title,
      source: memory.source,
      summary: memory.content,
      confidence: memory.confidence,
      capturedAt: memory.updatedAt
    }));

  return SharedContextSchema.parse({
    workItemId: workItem.id,
    activeGoal: workItem.repo ? `${workItem.title} [${workItem.repo}]` : workItem.title,
    acceptanceCriteria: workItem.acceptanceCriteria,
    buildContract: relevant
      .filter((artifact) => artifact.stage === "CONTRACT")
      .flatMap((artifact) => artifact.decisions),
    toolIntegrations: summarizeToolIntegrations(options.targetRepoConfig, {
      workItem,
      stage: options.stage,
      agent: options.agent
    }),
    contextNotes: [
      ...memories
        .filter((memory) => memory.kind === "preference" || memory.source.startsWith("context-file:"))
        .map((memory) => `${memory.title}: ${memory.content}`),
      ...capabilityPackNotes(options.targetRepoConfig, {
        workItem,
        stage: options.stage,
        agent: options.agent
      })
    ],
    teammateActivity,
    researchFindings: [...artifactResearch, ...memoryResearch],
    openQuestions: [],
    decisions: [
      ...relevant.flatMap((artifact) => artifact.decisions),
      ...memories.filter((memory) => memory.kind === "decision" || memory.kind === "architecture").map((memory) => memory.content)
    ],
    risks: [
      ...relevant.flatMap((artifact) => artifact.risks),
      ...memories.filter((memory) => memory.kind === "risk" || memory.kind === "failure").map((memory) => memory.content)
    ],
    blockers: relevant.filter((artifact) => artifact.status === "blocked").map((artifact) => artifact.summary),
    updatedAt: new Date().toISOString()
  });
}

export function formatSharedContext(context: SharedContext): string {
  const teammates = context.teammateActivity
    .map((activity) => `${activity.agent} on ${activity.stage}: ${activity.summary}`)
    .join("\n");
  const research = context.researchFindings
    .map((finding) => `${finding.topic} (${finding.confidence}): ${finding.summary}`)
    .join("\n");
  const tools = context.toolIntegrations
    .map((integration) => {
      const risk = integration.risks.length ? ` Risks: ${integration.risks.join("; ")}` : "";
      const notes = integration.notes.length ? ` Notes: ${integration.notes.join("; ")}` : "";
      return `${integration.name} [${integration.enabled ? "enabled" : "disabled"}]: ${integration.summary}${risk}${notes}`;
    })
    .join("\n");
  return [
    `Active goal: ${context.activeGoal}`,
    `Acceptance criteria: ${context.acceptanceCriteria.join("; ") || "none"}`,
    `Build contract: ${context.buildContract.join("; ") || "not locked yet"}`,
    `Repo context:\n${context.contextNotes.join("\n") || "none"}`,
    `Tool integrations:\n${tools || "none"}`,
    `Teammate activity:\n${teammates || "none"}`,
    `Research findings:\n${research || "none"}`,
    `Decisions: ${context.decisions.join("; ") || "none"}`,
    `Risks: ${context.risks.join("; ") || "none"}`,
    `Blockers: ${context.blockers.join("; ") || "none"}`
  ].join("\n\n");
}

export interface CapabilitySelectionInput {
  workItem?: WorkItem;
  stage?: WorkItemState;
  agent?: AgentRole;
}

export function summarizeToolIntegrations(config?: TargetRepoConfig, input: CapabilitySelectionInput = {}): ToolIntegrationContext[] {
  if (!config) return [];

  const integrations: ToolIntegrationContext[] = [];
  const electron = config.integrations.electron;
  if (electron.enabled || electron.notes.length || electron.appPath || electron.launchCommand || electron.testCommand) {
    integrations.push({
      name: "Electron app automation",
      kind: "electron",
      enabled: electron.enabled,
      summary: [
        `preferred=${electron.preferredAutomation}`,
        electron.appPath ? `appPath=${electron.appPath}` : "",
        electron.launchCommand ? `launchCommand=${electron.launchCommand}` : "",
        electron.devServerUrl ? `devServerUrl=${electron.devServerUrl}` : "",
        electron.debugPort ? `debugPort=${electron.debugPort}` : "",
        electron.testCommand ? `testCommand=${electron.testCommand}` : "",
        `artifactsDir=${electron.artifactsDir}`
      ].filter(Boolean).join(", "),
      risks: [
        electron.allowRemoteDebugging
          ? "Remote debugging can expose renderer data and should use local-only disposable profiles."
          : "Remote debugging is blocked unless policy explicitly enables it.",
        electron.requireIsolatedProfile ? "" : "Persistent Electron profiles can leak local session state into agent runs."
      ].filter(Boolean),
      notes: electron.notes
    });
  }

  for (const server of config.integrations.mcpServers) {
    const active = shouldActivateCapability(server.enabled, server.activation, input);
    integrations.push({
      name: `MCP:${server.name}`,
      kind: "mcp",
      enabled: active,
      summary: server.transport === "stdio"
        ? `stdio ${server.command} ${server.args.join(" ")}`.trim()
        : `streamable_http ${server.url}`,
      risks: [
        server.toolAllowlist.length ? "" : "No tool allowlist configured; expose only trusted MCP servers.",
        Object.keys(server.env).length ? `Environment variables configured: ${Object.keys(server.env).join(", ")}.` : ""
      ].filter(Boolean),
      notes: [
        server.transport,
        `timeout=${server.timeoutSeconds}s`,
        server.toolAllowlist.length ? `allowedTools=${server.toolAllowlist.join(",")}` : "",
        `activation=${describeActivation(server.activation)}`,
        ...server.notes
      ].filter(Boolean)
    });
  }

  for (const pack of config.integrations.capabilityPacks) {
    const active = shouldActivateCapability(pack.enabled, pack.activation, input);
    integrations.push({
      name: `Capability:${pack.name}`,
      kind: pack.kind,
      enabled: active,
      summary: pack.summary,
      risks: [],
      notes: [
        `activation=${describeActivation(pack.activation)}`,
        pack.contextFiles.length ? `contextFiles=${pack.contextFiles.map((file) => file.path).join(",")}` : "",
        ...pack.notes
      ].filter(Boolean)
    });
  }

  return integrations;
}

export function shouldActivateCapability(
  enabled: boolean,
  activation: CapabilityActivation,
  input: CapabilitySelectionInput = {}
): boolean {
  if (!enabled) return false;
  if (activation.mode === "manual") return false;
  if (activation.mode === "always") return true;

  if (input.stage && activation.stages.includes(input.stage)) return true;
  if (input.agent && activation.agents.includes(input.agent)) return true;

  const haystack = [
    input.workItem?.title,
    input.workItem?.requestType,
    input.workItem?.priority,
    input.workItem?.riskLevel,
    ...(input.workItem?.acceptanceCriteria || [])
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return activation.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function capabilityPackNotes(config?: TargetRepoConfig, input: CapabilitySelectionInput = {}): string[] {
  if (!config) return [];
  return config.integrations.capabilityPacks
    .filter((pack) => shouldActivateCapability(pack.enabled, pack.activation, input))
    .map((pack) => `${pack.name}: ${pack.summary}${pack.notes.length ? ` Notes: ${pack.notes.join("; ")}` : ""}`);
}

function describeActivation(activation: CapabilityActivation): string {
  if (activation.mode !== "on_demand") return activation.mode;
  const parts = [
    activation.stages.length ? `stages:${activation.stages.join("|")}` : "",
    activation.agents.length ? `agents:${activation.agents.join("|")}` : "",
    activation.keywords.length ? `keywords:${activation.keywords.join("|")}` : ""
  ].filter(Boolean);
  return parts.length ? `on_demand(${parts.join(";")})` : "on_demand(no rules configured)";
}

export function memoryFromArtifact(artifact: StageArtifact): MemoryRecord[] {
  const now = new Date().toISOString();
  const records: MemoryRecord[] = [];

  if (artifact.stage === "RND") {
    records.push(createMemoryRecord(artifact, {
      id: `${artifact.workItemId}-${artifact.stage}-research`,
      kind: "research",
      title: `${artifact.stage} research`,
      content: artifact.summary,
      importance: 5,
      permanence: "permanent"
    }, now));
  }

  if (artifact.stage === "RELEASE") {
    records.push(createMemoryRecord(artifact, {
      id: `${artifact.workItemId}-${artifact.stage}-release`,
      kind: "release",
      title: `${artifact.stage} release decision`,
      content: artifact.summary,
      importance: 5,
      permanence: "permanent"
    }, now));
  }

  if (artifact.status === "blocked" || artifact.status === "failed" || artifact.stage === "BLOCKED") {
    records.push(createMemoryRecord(artifact, {
      id: `${artifact.workItemId}-${artifact.stage}-failure`,
      kind: "failure",
      title: `${artifact.stage} failure or blocker`,
      content: artifact.summary,
      importance: 5,
      permanence: "permanent"
    }, now));
  }

  if (artifact.nextStage) {
    records.push(createMemoryRecord(artifact, {
      id: `${artifact.workItemId}-${artifact.stage}-handoff`,
      kind: "handoff",
      title: `${artifact.stage} handoff`,
      content: artifact.summary,
      importance: artifact.stage === "CONTRACT" ? 5 : 3,
      permanence: "durable"
    }, now));
  }

  for (const [index, decision] of artifact.decisions.entries()) {
    records.push({
      id: `${artifact.workItemId}-${artifact.stage}-decision-${index}`,
      scope: "work_item",
      workItemId: artifact.workItemId,
      projectId: artifact.projectId,
      repo: artifact.repo,
      agent: artifact.ownerAgent,
      kind: artifact.stage === "RND" || artifact.stage === "CONTRACT" ? "architecture" : "decision",
      title: `${artifact.stage} decision`,
      content: decision,
      tags: [artifact.stage, artifact.ownerAgent],
      confidence: artifact.status === "passed" ? "high" : "medium",
      importance: artifact.stage === "RELEASE" || artifact.stage === "CONTRACT" ? 5 : 3,
      permanence: artifact.stage === "RND" || artifact.stage === "CONTRACT" || artifact.stage === "RELEASE" ? "permanent" : "durable",
      source: `${artifact.ownerAgent}:${artifact.stage}`,
      createdAt: now,
      updatedAt: now
    });
  }

  for (const [index, risk] of artifact.risks.entries()) {
    records.push({
      id: `${artifact.workItemId}-${artifact.stage}-risk-${index}`,
      scope: "work_item",
      workItemId: artifact.workItemId,
      projectId: artifact.projectId,
      repo: artifact.repo,
      agent: artifact.ownerAgent,
      kind: "risk",
      title: `${artifact.stage} risk`,
      content: risk,
      tags: [artifact.stage, artifact.ownerAgent, "risk"],
      confidence: "medium",
      importance: 4,
      permanence: "durable",
      source: `${artifact.ownerAgent}:${artifact.stage}`,
      createdAt: now,
      updatedAt: now
    });
  }

  return records;
}

function createMemoryRecord(
  artifact: StageArtifact,
  input: Pick<MemoryRecord, "id" | "kind" | "title" | "content" | "importance" | "permanence">,
  now: string
): MemoryRecord {
  return {
    id: input.id,
    scope: "work_item",
    workItemId: artifact.workItemId,
    projectId: artifact.projectId,
    repo: artifact.repo,
    agent: artifact.ownerAgent,
    kind: input.kind,
    title: input.title,
    content: input.content,
    tags: [artifact.stage, artifact.ownerAgent, input.kind],
    confidence: artifact.status === "passed" ? "high" : "medium",
    importance: input.importance,
    permanence: input.permanence,
    source: `${artifact.ownerAgent}:${artifact.stage}`,
    createdAt: now,
    updatedAt: now
  };
}

export function selectRelevantMemories(memories: MemoryRecord[], workItem: WorkItem, limit = 12): MemoryRecord[] {
  const projectId = workItem.projectId;
  const repo = workItem.repo;
  const now = Date.now();
  return memories
    .filter((memory) => !memory.expiresAt || Date.parse(memory.expiresAt) > now)
    .filter((memory) => isMemoryInProjectScope(memory, { projectId, repo, workItemId: workItem.id }))
    .filter((memory) =>
      memory.scope === "repo" ||
      memory.workItemId === workItem.id ||
      memory.tags.some((tag) => workItem.title.toLowerCase().includes(tag.toLowerCase()))
    )
    .sort((a, b) => b.importance - a.importance || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}

export async function loadRepoContextMemories(config: TargetRepoConfig, workItem: WorkItem, now = new Date().toISOString()): Promise<MemoryRecord[]> {
  const repoRoot = path.resolve(config.repo.localPath || process.cwd());
  const contextFiles = await discoverContextFiles(config, repoRoot);
  const selected = contextFiles.slice(0, config.context.maxFiles);
  const memories: MemoryRecord[] = [];
  const projectId = projectIdForConfig(config);
  const repo = repoKeyForConfig(config);

  for (const file of selected) {
    const content = await readContextFile(file.path, file.maxBytes);
    if (!content.trim()) continue;
    const relativePath = path.relative(repoRoot, file.path).replace(/\\/g, "/");
    memories.push({
      id: `repo-context-${hashId(relativePath)}`,
      scope: "repo",
      projectId,
      repo,
      kind: "preference",
      title: file.description || `Context ${relativePath}`,
      content,
      tags: tagsForContextFile(relativePath, workItem),
      confidence: "high",
      importance: file.required ? 5 : 4,
      permanence: "permanent",
      source: `context-file:${relativePath}`,
      createdAt: now,
      updatedAt: now
    });
  }

  return memories;
}

export function repoKeyForConfig(config: TargetRepoConfig): string {
  return `${config.repo.owner}/${config.repo.name}`;
}

export function projectIdForConfig(config: TargetRepoConfig): string {
  return config.project.id || config.project.isolation.memoryNamespace || repoKeyForConfig(config);
}

export function scopeWorkItemToProject(workItem: WorkItem, config: TargetRepoConfig): WorkItem {
  return {
    ...workItem,
    projectId: projectIdForConfig(config),
    repo: repoKeyForConfig(config)
  };
}

function isMemoryInProjectScope(memory: MemoryRecord, scope: { projectId?: string; repo?: string; workItemId?: string }): boolean {
  if (memory.scope === "global") return false;
  if (memory.workItemId) return memory.workItemId === scope.workItemId;
  if (memory.projectId && scope.projectId) return memory.projectId === scope.projectId;
  if (memory.repo && scope.repo) return memory.repo === scope.repo;
  return memory.scope !== "repo";
}

type ContextFileCandidate = {
  path: string;
  description?: string;
  required: boolean;
  maxBytes: number;
};

async function discoverContextFiles(config: TargetRepoConfig, repoRoot: string): Promise<ContextFileCandidate[]> {
  const byPath = new Map<string, ContextFileCandidate>();
  const addCandidate = (candidate: ContextFileCandidate) => {
    if (!isInside(repoRoot, candidate.path)) {
      if (candidate.required) throw new Error(`Context file must stay inside repo root: ${candidate.path}`);
      return;
    }
    byPath.set(candidate.path, candidate);
  };

  if (config.context.includeDefaultContextDir) {
    const dir = safeResolve(repoRoot, config.context.defaultContextDir);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !/\.(md|txt)$/i.test(entry.name)) continue;
        addCandidate({
          path: path.join(dir, entry.name),
          required: false,
          maxBytes: config.context.maxBytesPerFile
        });
      }
    } catch {
      // Missing context directory is expected for many repos.
    }
  }

  for (const configured of config.context.files) {
    addCandidate({
      path: safeResolve(repoRoot, configured.path),
      description: configured.description,
      required: configured.required,
      maxBytes: Math.min(configured.maxBytes, config.context.maxBytesPerFile)
    });
  }

  return [...byPath.values()].sort((a, b) => Number(b.required) - Number(a.required) || a.path.localeCompare(b.path));
}

async function readContextFile(filePath: string, maxBytes: number): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const sliced = buffer.byteLength > maxBytes ? buffer.subarray(0, maxBytes) : buffer;
  const suffix = buffer.byteLength > maxBytes ? "\n\n[Truncated by context byte limit.]" : "";
  return sliced.toString("utf8").trim() + suffix;
}

function safeResolve(repoRoot: string, candidate: string): string {
  return path.resolve(repoRoot, candidate);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hashId(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function tagsForContextFile(relativePath: string, workItem: WorkItem): string[] {
  const nameParts = relativePath
    .toLowerCase()
    .replace(/\.(md|txt)$/i, "")
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 2);
  return [...new Set(["context", "repo", workItem.requestType, ...nameParts])];
}

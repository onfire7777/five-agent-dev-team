import pg from "pg";
import crypto from "node:crypto";
import {
  canTransition,
  AgentEventSchema,
  createSampleArtifacts,
  createSampleStatus,
  createSampleWorkItems,
  DEFAULT_SCHEDULER_POLICY,
  dependenciesSatisfied,
  loadTargetRepoConfig,
  projectIdForConfig,
  ProjectCapabilityStatusSchema,
  ProjectConnectionInputSchema,
  ProjectConnectionSchema,
  ProjectTeamStatusSchema,
  repoKeyForConfig,
  StageArtifactSchema,
  MemoryRecordSchema,
  memoryFromArtifact,
  selectRelevantMemories,
  WorkItemSchema,
  githubToken,
  type AgentEvent,
  type MemoryRecord,
  type ProjectConnection,
  type ProjectConnectionInput,
  type StageArtifact,
  type WorkItem,
  type WorkItemState
} from "../../../packages/shared/src";

type ControllerStatus = ReturnType<typeof createSampleStatus>;
type WorkItemCreateInput = Pick<WorkItem, "title" | "priority" | "requestType" | "dependencies" | "acceptanceCriteria" | "riskLevel" | "frontendNeeded" | "backendNeeded" | "rndNeeded"> & Partial<Pick<WorkItem, "projectId" | "repo">>;
type ProjectScope = { projectId?: string; repo?: string };
type ProjectConnectionPersistInput = ProjectConnectionInput & Partial<Pick<ProjectConnection, "remoteUrl" | "ghAvailable" | "ghAuthed" | "githubCliVersion" | "githubMcpAvailable" | "githubMcpAuthenticated" | "githubMcpVersion" | "githubSdkConnected" | "githubSdkVersion" | "githubConnected" | "remoteMatches" | "defaultBranchVerified" | "capabilities" | "validationErrors" | "lastValidatedAt" | "status">>;

export interface ControllerStore {
  init(): Promise<void>;
  getStatus(): Promise<ControllerStatus>;
  listWorkItems(): Promise<WorkItem[]>;
  createWorkItem(input: WorkItemCreateInput): Promise<WorkItem>;
  updateWorkItemState(id: string, state: WorkItemState): Promise<void>;
  addArtifact(artifact: StageArtifact): Promise<void>;
  addEvent(event: Omit<AgentEvent, "sequence" | "createdAt"> & Partial<Pick<AgentEvent, "sequence" | "createdAt">>): Promise<AgentEvent>;
  listEvents(afterSequence?: number, limit?: number): Promise<AgentEvent[]>;
  listMemories(workItemId?: string): Promise<MemoryRecord[]>;
  addMemories(memories: MemoryRecord[]): Promise<void>;
  listProjectConnections(): Promise<ProjectConnection[]>;
  upsertProjectConnection(input: ProjectConnectionPersistInput): Promise<ProjectConnection>;
  activateProjectConnection(id: string): Promise<ProjectConnection>;
  claimWorkItemForWorkflow(id: string): Promise<boolean>;
  listWorkflowClaims(): Promise<string[]>;
  releaseWorkItemWorkflowClaim(id: string): Promise<void>;
  setEmergencyStop(active: boolean, reason?: string): Promise<void>;
}

export class MemoryStore implements ControllerStore {
  private workItems = createSampleWorkItems();
  private artifacts = createSampleArtifacts();
  private memories: MemoryRecord[] = [];
  private projectConnections: ProjectConnection[] = [];
  private events: AgentEvent[] = [];
  private nextEventSequence = 1;
  private workflowClaims = new Set<string>();
  private emergencyStop = false;
  private emergencyReason = "";

  async init(): Promise<void> {
    await this.seedConfiguredProjectConnection();
    return;
  }

  async getStatus() {
    const status = createSampleStatus();
    const projectTeams = buildProjectTeams(this.projectConnections, this.workItems);
    const agentTotals = summarizeAgents(projectTeams);
    return {
      ...status,
      system: {
        ...status.system,
        operational: !this.emergencyStop,
        emergencyStop: this.emergencyStop,
        emergencyReason: this.emergencyReason,
        agentsOnline: agentTotals.online,
        agentsTotal: agentTotals.total,
        githubSync: projectTeams.length ? "release-gated" : "connect-repo",
        queueDepth: countRunnableWorkItems(this.workItems)
      },
      projectTeams,
      workItems: this.workItems,
      artifacts: this.artifacts
    };
  }

  async listWorkItems(): Promise<WorkItem[]> {
    return this.workItems;
  }

  async createWorkItem(input: WorkItemCreateInput): Promise<WorkItem> {
    const createdAt = new Date().toISOString();
    const project = await this.resolveProjectScope(input);
    const workItem = WorkItemSchema.parse({
      id: createWorkItemId(),
      state: "NEW",
      createdAt,
      updatedAt: createdAt,
      ...input,
      projectId: input.projectId || project.projectId,
      repo: input.repo || project.repo
    });
    this.workItems.unshift(workItem);
    return workItem;
  }

  async updateWorkItemState(id: string, state: WorkItemState): Promise<void> {
    const current = this.workItems.find((item) => item.id === id);
    if (!current) throw new Error(`Work item ${id} was not found.`);
    if (current.state !== state && !canTransition(current.state, state)) {
      throw new Error(`Invalid work-item transition from ${current.state} to ${state}.`);
    }
    this.workItems = this.workItems.map((item) =>
      item.id === id ? { ...item, state, updatedAt: new Date().toISOString() } : item
    );
  }

  async addArtifact(artifact: StageArtifact): Promise<void> {
    this.artifacts.unshift(StageArtifactSchema.parse(artifact));
    await this.addMemories(memoryFromArtifact(artifact));
  }

  async addEvent(event: Omit<AgentEvent, "sequence" | "createdAt"> & Partial<Pick<AgentEvent, "sequence" | "createdAt">>): Promise<AgentEvent> {
    const parsed = AgentEventSchema.parse({
      sequence: event.sequence ?? this.nextEventSequence++,
      createdAt: event.createdAt ?? new Date().toISOString(),
      ...event
    });
    this.nextEventSequence = Math.max(this.nextEventSequence, parsed.sequence + 1);
    this.events.push(parsed);
    this.events = this.events.slice(-500);
    return parsed;
  }

  async listEvents(afterSequence = 0, limit = 50): Promise<AgentEvent[]> {
    return this.events
      .filter((event) => event.sequence > afterSequence)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit);
  }

  async listMemories(workItemId?: string): Promise<MemoryRecord[]> {
    if (!workItemId) return this.memories;
    const workItem = this.workItems.find((item) => item.id === workItemId);
    if (workItem) return selectRelevantMemories(this.memories, workItem, 100);
    return this.memories.filter((memory) =>
      memory.workItemId === workItemId
    );
  }

  async addMemories(memories: MemoryRecord[]): Promise<void> {
    const parsed = memories.map((memory) => MemoryRecordSchema.parse(memory));
    const byId = new Map(this.memories.map((memory) => [memory.id, memory]));
    for (const memory of parsed) {
      byId.set(memory.id, memory);
    }
    this.memories = [...byId.values()];
  }

  async listProjectConnections(): Promise<ProjectConnection[]> {
    await this.seedConfiguredProjectConnection();
    return sortProjectConnections(this.projectConnections);
  }

  async upsertProjectConnection(input: ProjectConnectionPersistInput): Promise<ProjectConnection> {
    const parsed = ProjectConnectionInputSchema.parse(input);
    const now = new Date().toISOString();
    const projectId = parsed.projectId || slugId(`${parsed.repoOwner}-${parsed.repoName}`);
    const repo = `${parsed.repoOwner}/${parsed.repoName}`;
    const diagnostics = input as ProjectConnectionPersistInput;
    const connection = ProjectConnectionSchema.parse({
      ...parsed,
      id: projectId,
      projectId,
      name: parsed.name || repo,
      repo,
      memoryNamespace: projectId,
      contextDir: ".agent-team/context",
      status: diagnostics.status || (parsed.active ? "connected" : "inactive"),
      remoteUrl: diagnostics.remoteUrl,
      ghAvailable: diagnostics.ghAvailable ?? false,
      ghAuthed: diagnostics.ghAuthed ?? false,
      githubCliVersion: diagnostics.githubCliVersion,
      githubMcpAvailable: diagnostics.githubMcpAvailable ?? false,
      githubMcpAuthenticated: diagnostics.githubMcpAuthenticated ?? false,
      githubMcpVersion: diagnostics.githubMcpVersion,
      githubSdkConnected: diagnostics.githubSdkConnected ?? false,
      githubSdkVersion: diagnostics.githubSdkVersion,
      githubConnected: diagnostics.githubConnected ?? false,
      remoteMatches: diagnostics.remoteMatches ?? false,
      defaultBranchVerified: diagnostics.defaultBranchVerified ?? false,
      capabilities: diagnostics.capabilities || [],
      validationErrors: diagnostics.validationErrors || [],
      lastValidatedAt: diagnostics.lastValidatedAt,
      createdAt: this.projectConnections.find((item) => item.id === projectId)?.createdAt || now,
      updatedAt: now
    });

    this.projectConnections = [
      ...this.projectConnections
        .filter((item) => item.id !== connection.id),
      connection
    ];
    return connection;
  }

  async activateProjectConnection(id: string): Promise<ProjectConnection> {
    const now = new Date().toISOString();
    const current = this.projectConnections.find((item) => item.id === id);
    if (!current) throw new Error(`Project connection ${id} was not found.`);
    const activated = ProjectConnectionSchema.parse({
      ...current,
      active: true,
      status: current.validationErrors.length ? current.status : "connected",
      updatedAt: now
    });
    this.projectConnections = this.projectConnections.map((item) =>
      item.id === id ? activated : item
    );
    return activated;
  }

  async claimWorkItemForWorkflow(id: string): Promise<boolean> {
    if (this.workflowClaims.has(id)) return false;
    this.workflowClaims.add(id);
    return true;
  }

  async listWorkflowClaims(): Promise<string[]> {
    return [...this.workflowClaims];
  }

  async releaseWorkItemWorkflowClaim(id: string): Promise<void> {
    this.workflowClaims.delete(id);
  }

  async setEmergencyStop(active: boolean, reason = ""): Promise<void> {
    this.emergencyStop = active;
    this.emergencyReason = active ? reason : "";
  }

  private async seedConfiguredProjectConnection(): Promise<void> {
    if (this.projectConnections.length) return;
    const connection = readConfiguredProjectConnection();
    if (connection) this.projectConnections = [connection];
  }

  protected async resolveProjectScope(input: ProjectScope): Promise<ProjectScope> {
    const connections = await this.listProjectConnections();
    const resolved = resolveProjectScopeFromConnections(input, connections);
    return resolved || resolveConfiguredProject();
  }
}

function resolveConfiguredProject(): { projectId?: string; repo?: string } {
  const configPath = process.env.AGENT_TEAM_CONFIG || "agent-team.config.yaml";
  try {
    const config = loadTargetRepoConfig(configPath);
    return {
      projectId: projectIdForConfig(config),
      repo: repoKeyForConfig(config)
    };
  } catch {
    return {};
  }
}

export class PostgresStore extends MemoryStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    super();
    this.pool = new pg.Pool({ connectionString });
  }

  override async init(): Promise<void> {
    await this.pool.query(`
      create table if not exists work_items (
        id text primary key,
        payload jsonb not null,
        state text not null,
        updated_at timestamptz not null default now()
      );
      create table if not exists stage_artifacts (
        id bigserial primary key,
        work_item_id text not null,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );
      create table if not exists agent_events (
        sequence bigserial primary key,
        work_item_id text,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );
      create table if not exists memory_records (
        id text primary key,
        payload jsonb not null,
        scope text not null,
        work_item_id text,
        importance integer not null,
        updated_at timestamptz not null default now()
      );
      create table if not exists workflow_claims (
        work_item_id text primary key,
        claimed_at timestamptz not null default now()
      );
      create table if not exists project_connections (
        id text primary key,
        payload jsonb not null,
        active boolean not null default false,
        updated_at timestamptz not null default now()
      );
      create table if not exists controller_flags (
        key text primary key,
        value jsonb not null
      );
    `);
    await this.seedProjectConnectionsFromConfig();
  }

  override async listWorkItems(): Promise<WorkItem[]> {
    const result = await this.pool.query("select payload from work_items order by updated_at desc");
    return result.rows.map((row) => WorkItemSchema.parse(row.payload));
  }

  override async getStatus() {
    const status = createSampleStatus();
    const workItems = await this.listWorkItems();
    const artifacts = await this.listArtifacts();
    const events = await this.listEvents(0, 50);
    const emergencyStop = await this.readEmergencyStopFlag();
    const pipeline = buildPipelineSummary(workItems);
    const recentArtifacts = artifacts.slice(0, 10);
    const projectTeams = buildProjectTeams(await this.listProjectConnections(), workItems);
    const agentTotals = summarizeAgents(projectTeams);
    return {
      ...status,
      system: {
        ...status.system,
        operational: !emergencyStop.active,
        emergencyStop: emergencyStop.active,
        emergencyReason: emergencyStop.reason,
        agentsOnline: agentTotals.online,
        agentsTotal: agentTotals.total,
        githubSync: projectTeams.length ? "release-gated" : "connect-repo",
        systemLoad: Math.min(100, workItems.filter((item) => item.state !== "CLOSED" && item.state !== "BLOCKED").length * 12),
        queueDepth: countRunnableWorkItems(workItems)
      },
      projectTeams,
      pipeline,
      workItems,
      artifacts,
      releaseReadiness: buildReleaseReadiness(artifacts),
      logs: events.length
        ? events.slice(-10).reverse().map((event) => [
          new Date(event.createdAt).toLocaleTimeString("en-US", { hour12: false }),
          event.level.toUpperCase(),
          event.ownerAgent || "system",
          event.message,
          event.workItemId || "-"
        ])
        : recentArtifacts.map((artifact) => [
          new Date(artifact.createdAt).toLocaleTimeString("en-US", { hour12: false }),
          artifact.status === "blocked" || artifact.status === "failed" ? "ERROR" : artifact.status === "running" ? "INFO" : "INFO",
          artifact.ownerAgent,
          artifact.summary,
          artifact.workItemId
        ]),
      sharedContext: {
        activeThreads: buildActiveThreads(workItems, artifacts),
        research: artifacts
          .filter((artifact) => artifact.stage === "RND")
          .slice(0, 5)
          .map((artifact) => artifact.summary)
      }
    };
  }

  override async createWorkItem(input: WorkItemCreateInput): Promise<WorkItem> {
    const workItem = await super.createWorkItem(input);
    await this.pool.query(
      "insert into work_items (id, payload, state) values ($1, $2, $3)",
      [workItem.id, workItem, workItem.state]
    );
    return workItem;
  }

  override async updateWorkItemState(id: string, state: WorkItemState): Promise<void> {
    const current = await this.pool.query("select payload from work_items where id = $1", [id]);
    if (!current.rows[0]) throw new Error(`Work item ${id} was not found.`);
    const currentItem = WorkItemSchema.parse(current.rows[0].payload);
    if (currentItem.state !== state && !canTransition(currentItem.state, state)) {
      throw new Error(`Invalid work-item transition from ${currentItem.state} to ${state}.`);
    }
    const updatedAt = new Date().toISOString();
    await this.pool.query(
      `update work_items
       set state = $2,
           payload = jsonb_set(jsonb_set(payload, '{state}', to_jsonb($2::text), true), '{updatedAt}', to_jsonb($3::text), true),
           updated_at = now()
       where id = $1`,
      [id, state, updatedAt]
    );
    try {
      await super.updateWorkItemState(id, state);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("was not found")) {
        throw error;
      }
    }
  }

  override async addArtifact(artifact: StageArtifact): Promise<void> {
    await this.pool.query(`
      alter table stage_artifacts add column if not exists artifact_key text;
      create unique index if not exists stage_artifacts_artifact_key_idx on stage_artifacts (artifact_key) where artifact_key is not null;
    `);
    const artifactKey = `${artifact.workItemId}:${artifact.stage}:${artifact.ownerAgent}`;
    await this.pool.query(
      `insert into stage_artifacts (work_item_id, payload, artifact_key, created_at)
       values ($1, $2, $3, $4)
       on conflict (artifact_key) where artifact_key is not null
       do update set payload = excluded.payload, created_at = excluded.created_at`,
      [artifact.workItemId, artifact, artifactKey, artifact.createdAt]
    );
    await super.addArtifact(artifact);
  }

  override async addEvent(event: Omit<AgentEvent, "sequence" | "createdAt"> & Partial<Pick<AgentEvent, "sequence" | "createdAt">>): Promise<AgentEvent> {
    const createdAt = event.createdAt ?? new Date().toISOString();
    const result = await this.pool.query(
      `insert into agent_events (work_item_id, payload, created_at)
       values ($1, $2, $3)
       returning sequence`,
      [event.workItemId || null, { ...event, sequence: 0, createdAt }, createdAt]
    );
    const parsed = AgentEventSchema.parse({
      ...event,
      sequence: Number(result.rows[0].sequence),
      createdAt
    });
    await this.pool.query("update agent_events set payload = $2 where sequence = $1", [parsed.sequence, parsed]);
    await super.addEvent(parsed);
    return parsed;
  }

  override async listEvents(afterSequence = 0, limit = 50): Promise<AgentEvent[]> {
    const result = await this.pool.query(
      `select payload from agent_events
       where sequence > $1
       order by sequence asc
       limit $2`,
      [afterSequence, limit]
    );
    const stored = result.rows.map((row) => AgentEventSchema.parse(row.payload));
    return stored.length ? stored : super.listEvents(afterSequence, limit);
  }

  override async claimWorkItemForWorkflow(id: string): Promise<boolean> {
    const result = await this.pool.query(
      "insert into workflow_claims (work_item_id) values ($1) on conflict do nothing returning work_item_id",
      [id]
    );
    return result.rowCount === 1;
  }

  override async listWorkflowClaims(): Promise<string[]> {
    const result = await this.pool.query("select work_item_id from workflow_claims order by claimed_at asc");
    return result.rows.map((row) => String(row.work_item_id));
  }

  override async releaseWorkItemWorkflowClaim(id: string): Promise<void> {
    await this.pool.query("delete from workflow_claims where work_item_id = $1", [id]);
  }

  override async listMemories(workItemId?: string): Promise<MemoryRecord[]> {
    const result = await this.pool.query("select payload from memory_records order by importance desc, updated_at desc");
    const stored = result.rows.map((row) => MemoryRecordSchema.parse(row.payload));
    if (!workItemId) return stored.length ? stored : super.listMemories();

    const workItemResult = await this.pool.query("select payload from work_items where id = $1", [workItemId]);
    const workItem = workItemResult.rows[0] ? WorkItemSchema.parse(workItemResult.rows[0].payload) : null;
    if (workItem) return selectRelevantMemories(stored, workItem, 100);

    const filtered = stored.filter((memory) => memory.workItemId === workItemId);
    return filtered.length ? filtered : super.listMemories(workItemId);
  }

  override async addMemories(memories: MemoryRecord[]): Promise<void> {
    for (const memory of memories.map((item) => MemoryRecordSchema.parse(item))) {
      await this.pool.query(
        `insert into memory_records (id, payload, scope, work_item_id, importance)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update set payload = excluded.payload, scope = excluded.scope, work_item_id = excluded.work_item_id, importance = excluded.importance, updated_at = now()`,
        [memory.id, memory, memory.scope, memory.workItemId || null, memory.importance]
      );
    }
    await super.addMemories(memories);
  }

  override async listProjectConnections(): Promise<ProjectConnection[]> {
    const result = await this.pool.query("select payload from project_connections order by active desc, updated_at desc");
    const stored = result.rows.map((row) => ProjectConnectionSchema.parse(row.payload));
    return stored.length ? stored : super.listProjectConnections();
  }

  override async upsertProjectConnection(input: ProjectConnectionPersistInput): Promise<ProjectConnection> {
    const connection = await super.upsertProjectConnection(input);
    await this.pool.query(
      `insert into project_connections (id, payload, active)
       values ($1, $2, $3)
       on conflict (id) do update set payload = excluded.payload, active = excluded.active, updated_at = now()`,
      [connection.id, connection, connection.active]
    );
    return connection;
  }

  override async activateProjectConnection(id: string): Promise<ProjectConnection> {
    const connections = await this.listProjectConnections();
    const current = connections.find((item) => item.id === id);
    if (!current) throw new Error(`Project connection ${id} was not found.`);
    const now = new Date().toISOString();
    const activated = ProjectConnectionSchema.parse({
      ...current,
      active: true,
      status: current.validationErrors.length ? current.status : "connected",
      updatedAt: now
    });
    await this.pool.query(
      `insert into project_connections (id, payload, active)
       values ($1, $2, true)
       on conflict (id) do update set payload = excluded.payload, active = true, updated_at = now()`,
      [activated.id, activated]
    );
    await super.upsertProjectConnection(activated);
    return activated;
  }

  protected override async resolveProjectScope(input: ProjectScope): Promise<ProjectScope> {
    const connections = await this.listProjectConnections();
    return resolveProjectScopeFromConnections(input, connections) || resolveConfiguredProject();
  }

  override async setEmergencyStop(active: boolean, reason = ""): Promise<void> {
    await this.pool.query(
      "insert into controller_flags (key, value) values ('emergency_stop', $1) on conflict (key) do update set value = excluded.value",
      [{ active, reason, updatedAt: new Date().toISOString() }]
    );
    await super.setEmergencyStop(active, reason);
  }

  private async listArtifacts(): Promise<StageArtifact[]> {
    const result = await this.pool.query("select payload from stage_artifacts order by created_at desc");
    return result.rows.map((row) => StageArtifactSchema.parse(row.payload));
  }

  private async readEmergencyStopFlag(): Promise<{ active: boolean; reason: string }> {
    const result = await this.pool.query("select value from controller_flags where key = 'emergency_stop'");
    if (!result.rows[0]) return { active: false, reason: "" };
    return {
      active: Boolean(result.rows[0].value?.active),
      reason: String(result.rows[0].value?.reason || "")
    };
  }

  private async seedProjectConnectionsFromConfig(): Promise<void> {
    const existing = await this.pool.query("select id from project_connections limit 1");
    if (existing.rows.length) return;
    const connection = readConfiguredProjectConnection();
    if (!connection) return;
    await this.pool.query(
      `insert into project_connections (id, payload, active)
       values ($1, $2, true)
       on conflict (id) do nothing`,
      [connection.id, connection]
    );
  }
}

export function createStore(): ControllerStore {
  if (process.env.DATABASE_URL) {
    return new PostgresStore(process.env.DATABASE_URL);
  }
  return new MemoryStore();
}

function buildPipelineSummary(workItems: WorkItem[]): ControllerStatus["pipeline"] {
  return {
    NEW: workItems.filter((item) => item.state === "NEW").length,
    INTAKE: workItems.filter((item) => item.state === "INTAKE").length,
    RND: workItems.filter((item) => item.state === "RND").length,
    CONTRACT: workItems.filter((item) => item.state === "CONTRACT").length,
    FRONTEND_BUILD: workItems.filter((item) => item.state === "FRONTEND_BUILD").length,
    BACKEND_BUILD: workItems.filter((item) => item.state === "BACKEND_BUILD").length,
    INTEGRATION: workItems.filter((item) => item.state === "INTEGRATION").length,
    VERIFY: workItems.filter((item) => item.state === "VERIFY").length,
    RELEASE: workItems.filter((item) => item.state === "RELEASE").length,
    CLOSED: workItems.filter((item) => item.state === "CLOSED").length,
    BLOCKED: workItems.filter((item) => item.state === "BLOCKED").length
  };
}

function countRunnableWorkItems(workItems: WorkItem[]): number {
  return workItems.filter((item) => item.state === "NEW" && dependenciesSatisfied(item, workItems)).length;
}

function countRunnableProjectWorkItems(workItems: WorkItem[], project: ProjectConnection): number {
  return workItems.filter((item) =>
    item.state === "NEW" &&
    dependenciesSatisfied(item, workItems) &&
    workItemMatchesProject(item, project)
  ).length;
}

function workItemMatchesProject(workItem: WorkItem, project: ProjectConnection): boolean {
  return workItem.projectId === project.projectId || workItem.repo === project.repo;
}

function buildProjectTeams(projects: ProjectConnection[], workItems: WorkItem[]): ControllerStatus["projectTeams"] {
  return projects
    .filter((project) => project.active)
    .map((project) => {
      const activeWorkItems = workItems.filter((item) =>
        !["NEW", "CLOSED", "BLOCKED"].includes(item.state) &&
        workItemMatchesProject(item, project)
      ).length;
      const capabilityStatuses = project.capabilities.length ? project.capabilities : fallbackProjectCapabilities(project);
      const hasAttention = project.status !== "connected" || capabilityStatuses.some((capability) =>
        capability.enabled && ["needs_auth", "missing", "error"].includes(capability.status)
      );
      return ProjectTeamStatusSchema.parse({
        projectId: project.projectId,
        repo: project.repo,
        name: project.name,
        active: project.active,
        status: hasAttention ? "attention" : "ready",
        agentsOnline: project.active ? 5 : 0,
        agentsTotal: project.active ? 5 : 0,
        queueDepth: countRunnableProjectWorkItems(workItems, project),
        activeWorkItems,
        maxParallelAgentRuns: DEFAULT_SCHEDULER_POLICY.maxConcurrentAgentRuns,
        maxConcurrentWorkflows: 1,
        maxConcurrentRepoWrites: DEFAULT_SCHEDULER_POLICY.maxConcurrentRepoWrites,
        memoryNamespace: project.memoryNamespace,
        capabilities: capabilityStatuses
      });
    });
}

function summarizeAgents(projectTeams: ControllerStatus["projectTeams"]): { online: number; total: number } {
  return {
    online: projectTeams.reduce((total, team) => total + team.agentsOnline, 0),
    total: projectTeams.reduce((total, team) => total + team.agentsTotal, 0)
  };
}

function fallbackProjectCapabilities(project: ProjectConnection) {
  return [
    ProjectCapabilityStatusSchema.parse({
      id: "github-cli",
      label: "GitHub CLI",
      kind: "github_cli",
      enabled: true,
      status: project.ghAvailable ? project.ghAuthed ? "ready" : "needs_auth" : "missing",
      summary: project.ghAvailable ? "gh is installed for deterministic GitHub operations." : "gh is not available in this runtime.",
      details: project.githubCliVersion ? [project.githubCliVersion] : []
    }),
    ProjectCapabilityStatusSchema.parse({
      id: "github-mcp",
      label: "GitHub MCP",
      kind: "github_mcp",
      enabled: project.githubMcpEnabled,
      status: !project.githubMcpEnabled ? "disabled" : project.githubMcpAvailable ? project.githubMcpAuthenticated ? "ready" : "needs_auth" : "missing",
      summary: project.githubMcpEnabled ? "Official GitHub MCP server is configured for on-demand toolsets." : "GitHub MCP is disabled for this project.",
      details: project.githubMcpVersion ? [project.githubMcpVersion] : []
    }),
    ProjectCapabilityStatusSchema.parse({
      id: "github-sdk",
      label: "GitHub SDK",
      kind: "github_sdk",
      enabled: true,
      status: project.githubSdkConnected ? "ready" : "needs_auth",
      summary: project.githubSdkConnected ? "Octokit can read this repository." : "Octokit needs a token that can read this repository.",
      details: project.githubSdkVersion ? [project.githubSdkVersion] : ["@octokit/rest"]
    }),
    ProjectCapabilityStatusSchema.parse({
      id: "repo-memory",
      label: "Repo Memory",
      kind: "memory",
      enabled: true,
      status: "ready",
      summary: `Permanent memory is isolated under ${project.memoryNamespace}.`,
      details: [project.contextDir]
    })
  ];
}

function buildReleaseReadiness(artifacts: StageArtifact[]): ControllerStatus["releaseReadiness"] {
  const latestRelease = artifacts.find((artifact) => artifact.stage === "RELEASE");
  const testsRun = artifacts.flatMap((artifact) => artifact.testsRun);
  return {
    status: latestRelease?.releaseReadiness || "unknown",
    target: latestRelease?.workItemId || "No release candidate",
    checks: [
      ["Tests", testsRun.length ? `${testsRun.length} configured/run` : "No runs yet"],
      ["Security Scan", testsRun.some((test) => test.toLowerCase().includes("security")) ? "Recorded" : "Pending"],
      ["Privacy Review", artifacts.some((artifact) => artifact.risks.some((risk) => risk.toLowerCase().includes("privacy"))) ? "Review required" : "No findings"],
      ["GitHub Actions", "Pending remote PR"],
      ["Local/Remote Sync", "Checked by release gate"]
    ]
  };
}

function buildActiveThreads(workItems: WorkItem[], artifacts: StageArtifact[]): ControllerStatus["sharedContext"]["activeThreads"] {
  return workItems
    .filter((item) => item.state !== "CLOSED")
    .slice(0, 5)
    .map((item) => {
      const latestArtifact = artifacts.find((artifact) => artifact.workItemId === item.id);
      return [
        latestArtifact?.ownerAgent || "product-delivery-orchestrator",
        item.id,
        latestArtifact?.summary || item.title
      ];
    });
}

function readConfiguredProjectConnection(): ProjectConnection | null {
  const configPath = process.env.AGENT_TEAM_CONFIG || "agent-team.config.yaml";
  try {
    const config = loadTargetRepoConfig(configPath);
    const now = new Date().toISOString();
    const projectId = projectIdForConfig(config);
    const repo = repoKeyForConfig(config);
    return ProjectConnectionSchema.parse({
      id: projectId,
      projectId,
      name: config.project.name || repo,
      repoOwner: config.repo.owner,
      repoName: config.repo.name,
      repo,
      defaultBranch: config.repo.defaultBranch,
      localPath: config.repo.localPath,
      githubUrl: `https://github.com/${repo}`,
      webResearchEnabled: config.integrations.capabilityPacks.some((pack) => pack.name === "deep-web-research" && pack.enabled) ||
        config.integrations.mcpServers.some((server) => server.category === "web_search" && server.enabled),
      githubMcpEnabled: config.integrations.mcpServers.some((server) => server.category === "github" && server.enabled),
      githubWriteEnabled: false,
      active: true,
      memoryNamespace: config.project.isolation.memoryNamespace || projectId,
      contextDir: config.context.defaultContextDir,
      status: "connected",
      githubMcpAvailable: config.integrations.mcpServers.some((server) =>
        server.category === "github" &&
        server.transport === "stdio" &&
        server.command === "github-mcp-server"
      ),
      githubMcpAuthenticated: Boolean(githubToken()),
      githubSdkConnected: false,
      createdAt: now,
      updatedAt: now
    });
  } catch {
    return null;
  }
}

function slugId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "project";
}

function resolveProjectScopeFromConnections(input: ProjectScope, connections: ProjectConnection[]): ProjectScope | null {
  if (!connections.length) return null;
  if (input.projectId || input.repo) {
    const match = connections.find((connection) => {
      if (input.projectId && input.repo) {
        return connection.projectId === input.projectId && connection.repo === input.repo;
      }
      return connection.projectId === input.projectId || connection.repo === input.repo;
    });
    if (!match) {
      throw new Error(`Connected project was not found for ${input.projectId || input.repo}.`);
    }
    return { projectId: match.projectId, repo: match.repo };
  }
  const active = connections.find((connection) => connection.active) || connections[0];
  return active ? { projectId: active.projectId, repo: active.repo } : null;
}

function createWorkItemId(): string {
  return `WI-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function sortProjectConnections(connections: ProjectConnection[]): ProjectConnection[] {
  return [...connections].sort((a, b) => Number(b.active) - Number(a.active) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

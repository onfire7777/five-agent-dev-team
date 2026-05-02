import pg from "pg";
import crypto from "node:crypto";
import {
  canTransition,
  AgentEventSchema,
  DEFAULT_SCHEDULER_POLICY,
  dependenciesSatisfied,
  loadTargetRepoConfig,
  projectIdForConfig,
  ProjectCapabilityStatusSchema,
  ProjectConnectionInputSchema,
  ProjectConnectionSchema,
  ProjectTeamStatusSchema,
  OpportunityScanRunSchema,
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
  type ProjectTeamStatus,
  type OpportunityScanRun,
  type StageArtifact,
  type WorkItem,
  type WorkItemState
} from "../../../packages/shared/src";

type PipelineSummary = Record<WorkItemState, number>;
type ReleaseReadinessSummary = {
  status: StageArtifact["releaseReadiness"];
  target: string;
  checks: Array<[string, string]>;
};
type StatusLogEntry = [time: string, level: string, owner: string, message: string, workItemId: string];
type SharedContextSummary = {
  activeThreads: Array<[string, string, string]>;
  research: string[];
};
type ControllerStatus = {
  system: {
    name: string;
    operational: boolean;
    emergencyStop: boolean;
    queueDepth: number;
    agentsOnline: number;
    agentsTotal: number;
    githubSync: string;
    systemLoad: number;
    executionMode: string;
    emergencyReason: string;
    scheduler: typeof DEFAULT_SCHEDULER_POLICY;
  };
  projectTeams: ProjectTeamStatus[];
  pipeline: PipelineSummary;
  workItems: WorkItem[];
  artifacts: StageArtifact[];
  releaseReadiness: ReleaseReadinessSummary;
  logs: StatusLogEntry[];
  sharedContext: SharedContextSummary;
};
type WorkItemCreateInput = Pick<
  WorkItem,
  | "title"
  | "priority"
  | "requestType"
  | "dependencies"
  | "acceptanceCriteria"
  | "riskLevel"
  | "frontendNeeded"
  | "backendNeeded"
  | "rndNeeded"
> &
  Partial<Pick<WorkItem, "projectId" | "repo">>;
type ProjectScope = { projectId?: string; repo?: string };
type ProjectConnectionPersistInput = ProjectConnectionInput &
  Partial<
    Pick<
      ProjectConnection,
      | "remoteUrl"
      | "ghAvailable"
      | "ghAuthed"
      | "githubCliVersion"
      | "githubMcpAvailable"
      | "githubMcpAuthenticated"
      | "githubMcpVersion"
      | "githubSdkConnected"
      | "githubSdkVersion"
      | "githubConnected"
      | "remoteMatches"
      | "defaultBranchVerified"
      | "capabilities"
      | "validationErrors"
      | "lastValidatedAt"
      | "status"
    >
  >;

export type StrictProjectScope = { projectId: string; repo: string };

export type TeamBusMessage = StrictProjectScope & {
  id: string;
  workItemId?: string;
  loopRunId?: string;
  from: string;
  to: string[];
  kind: "note" | "handoff" | "decision" | "blocker" | "status";
  topic: string;
  body: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type LoopRun = StrictProjectScope & {
  id: string;
  workItemId?: string;
  directionId?: string;
  opportunityId?: string;
  proposalId?: string;
  status: "running" | "awaiting_acceptance" | "blocked" | "closed" | "failed";
  summary: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
};

export type Direction = StrictProjectScope & {
  id: string;
  title: string;
  summary: string;
  goals: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  createdAt: string;
  updatedAt: string;
};

export type Opportunity = StrictProjectScope & {
  id: string;
  workItemId?: string;
  title: string;
  summary: string;
  source: "operator" | "agent" | "github" | "research" | "system";
  priority: "low" | "medium" | "high" | "urgent";
  status: "new" | "evaluating" | "proposed" | "accepted" | "rejected";
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type OpportunityScanRunInput = Pick<OpportunityScanRun, "summary"> &
  Partial<
    Pick<
      OpportunityScanRun,
      "id" | "status" | "sources" | "repoSha" | "memoryVersion" | "candidatesCreated" | "startedAt" | "completedAt"
    >
  >;

export type ProposalOption = {
  title: string;
  summary: string;
  tradeoffs: string[];
};

export type ProposalDecision = {
  decision: "accept" | "revise" | "reject";
  decidedBy: string;
  reason: string;
  requestedChanges: string[];
  decidedAt: string;
};

export type Proposal = StrictProjectScope & {
  id: string;
  workItemId?: string;
  loopRunId?: string;
  opportunityId?: string;
  title: string;
  summary: string;
  researchFindings: string[];
  options: ProposalOption[];
  recommendation: string;
  acceptanceCriteria: string[];
  implementationPlan: string[];
  validationPlan: string[];
  risks: string[];
  status: "draft" | "proposed" | "accepted" | "revising" | "rejected";
  decision?: ProposalDecision;
  createdAt: string;
  updatedAt: string;
};

export type TeamBusMessageInput = Pick<TeamBusMessage, "from" | "kind" | "topic" | "body"> &
  Partial<Pick<TeamBusMessage, "id" | "workItemId" | "loopRunId" | "to" | "payload">>;
export type LoopRunInput = Partial<
  Pick<
    LoopRun,
    "id" | "workItemId" | "directionId" | "opportunityId" | "proposalId" | "status" | "summary" | "closedAt"
  >
>;
export type DirectionInput = Pick<Direction, "title" | "summary"> &
  Partial<Pick<Direction, "id" | "goals" | "constraints" | "acceptanceCriteria">>;
export type OpportunityInput = Pick<Opportunity, "title" | "summary"> &
  Partial<Pick<Opportunity, "id" | "workItemId" | "source" | "priority" | "status" | "tags">>;
export type ProposalInput = Pick<Proposal, "title" | "summary" | "recommendation"> &
  Partial<
    Pick<
      Proposal,
      | "id"
      | "workItemId"
      | "loopRunId"
      | "opportunityId"
      | "researchFindings"
      | "options"
      | "acceptanceCriteria"
      | "implementationPlan"
      | "validationPlan"
      | "risks"
      | "status"
    >
  >;
export type ProposalDecisionInput = Pick<ProposalDecision, "decision" | "decidedBy" | "reason"> &
  Partial<Pick<ProposalDecision, "requestedChanges">>;

export interface ControllerStore {
  init(): Promise<void>;
  getStatus(): Promise<ControllerStatus>;
  listWorkItems(): Promise<WorkItem[]>;
  getWorkItemWithArtifacts(id: string): Promise<{ workItem: WorkItem; artifacts: StageArtifact[] } | null>;
  createWorkItem(input: WorkItemCreateInput): Promise<WorkItem>;
  updateWorkItemState(id: string, state: WorkItemState): Promise<void>;
  addArtifact(artifact: StageArtifact): Promise<void>;
  getArtifact(id: string): Promise<StageArtifact | null>;
  addEvent(
    event: Omit<AgentEvent, "sequence" | "createdAt"> & Partial<Pick<AgentEvent, "sequence" | "createdAt">>
  ): Promise<AgentEvent>;
  listEvents(afterSequence?: number, limit?: number): Promise<AgentEvent[]>;
  listMemories(workItemId?: string): Promise<MemoryRecord[]>;
  addMemories(memories: MemoryRecord[]): Promise<void>;
  listProjectConnections(): Promise<ProjectConnection[]>;
  upsertProjectConnection(input: ProjectConnectionPersistInput): Promise<ProjectConnection>;
  activateProjectConnection(id: string): Promise<ProjectConnection>;
  deactivateProjectConnection(id: string): Promise<ProjectConnection>;
  listTeamBusMessages(scope: StrictProjectScope): Promise<TeamBusMessage[]>;
  addTeamBusMessage(scope: StrictProjectScope, input: TeamBusMessageInput): Promise<TeamBusMessage>;
  listLoopRuns(scope: StrictProjectScope): Promise<LoopRun[]>;
  upsertLoopRun(scope: StrictProjectScope, input: LoopRunInput): Promise<LoopRun>;
  getDirection(scope: StrictProjectScope): Promise<Direction | null>;
  upsertDirection(scope: StrictProjectScope, input: DirectionInput): Promise<Direction>;
  listOpportunities(scope: StrictProjectScope): Promise<Opportunity[]>;
  upsertOpportunity(scope: StrictProjectScope, input: OpportunityInput): Promise<Opportunity>;
  listOpportunityScanRuns(scope: StrictProjectScope): Promise<OpportunityScanRun[]>;
  upsertOpportunityScanRun(scope: StrictProjectScope, input: OpportunityScanRunInput): Promise<OpportunityScanRun>;
  listProposals(scope: StrictProjectScope): Promise<Proposal[]>;
  upsertProposal(scope: StrictProjectScope, input: ProposalInput): Promise<Proposal>;
  decideProposal(scope: StrictProjectScope, proposalId: string, input: ProposalDecisionInput): Promise<Proposal>;
  claimWorkItemForWorkflow(id: string): Promise<boolean>;
  listWorkflowClaims(): Promise<string[]>;
  releaseWorkItemWorkflowClaim(id: string): Promise<void>;
  setEmergencyStop(active: boolean, reason?: string): Promise<void>;
}

export class MemoryStore implements ControllerStore {
  private workItems: WorkItem[] = [];
  private artifacts: StageArtifact[] = [];
  private memories: MemoryRecord[] = [];
  private projectConnections: ProjectConnection[] = [];
  private teamBusMessages: TeamBusMessage[] = [];
  private loopRuns: LoopRun[] = [];
  private directions: Direction[] = [];
  private opportunities: Opportunity[] = [];
  private opportunityScanRuns: OpportunityScanRun[] = [];
  private proposals: Proposal[] = [];
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
    return buildControllerStatus({
      workItems: this.workItems,
      artifacts: this.artifacts,
      events: this.events,
      projectConnections: await this.listProjectConnections(),
      emergencyStop: this.emergencyStop,
      emergencyReason: this.emergencyReason
    });
  }

  async listWorkItems(): Promise<WorkItem[]> {
    return this.workItems;
  }

  async getWorkItemWithArtifacts(id: string): Promise<{ workItem: WorkItem; artifacts: StageArtifact[] } | null> {
    const workItem = this.workItems.find((item) => item.id === id);
    if (!workItem) return null;
    return {
      workItem,
      artifacts: this.artifacts.filter((artifact) => artifact.workItemId === id)
    };
  }

  async createWorkItem(input: WorkItemCreateInput): Promise<WorkItem> {
    const createdAt = new Date().toISOString();
    const project = await this.resolveProjectScope(input);
    const workItem = WorkItemSchema.parse({
      id: createWorkItemId(),
      state: "NEW",
      createdAt,
      stateChangedAt: createdAt,
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
    const updatedAt = new Date().toISOString();
    const stateChangedAt = current.state === state ? current.stateChangedAt || updatedAt : updatedAt;
    this.workItems = this.workItems.map((item) =>
      item.id === id ? { ...item, state, stateChangedAt, updatedAt } : item
    );
  }

  async addArtifact(artifact: StageArtifact): Promise<void> {
    const parsed = StageArtifactSchema.parse(artifact);
    this.artifacts.unshift(parsed);
    await this.addMemories(memoryFromArtifact(parsed));
  }

  async getArtifact(id: string): Promise<StageArtifact | null> {
    return this.artifacts.find((artifact) => artifact.artifactId === id) || null;
  }

  async addEvent(
    event: Omit<AgentEvent, "sequence" | "createdAt"> & Partial<Pick<AgentEvent, "sequence" | "createdAt">>
  ): Promise<AgentEvent> {
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
    return this.memories.filter((memory) => memory.workItemId === workItemId);
  }

  async addMemories(memories: MemoryRecord[]): Promise<void> {
    const parsed = memories.map((memory) => MemoryRecordSchema.parse(memory));
    const byId = new Map(this.memories.map((memory) => [memory.id, memory]));
    for (const memory of parsed) {
      if (isLiveKeyedMemory(memory)) {
        for (const [id, existing] of byId) {
          if (id !== memory.id && isSameLiveMemoryKey(existing, memory)) {
            byId.set(id, { ...existing, supersededBy: memory.id, updatedAt: memory.updatedAt });
          }
        }
      }
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

    this.projectConnections = [...this.projectConnections.filter((item) => item.id !== connection.id), connection];
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
    this.projectConnections = this.projectConnections.map((item) => (item.id === id ? activated : item));
    return activated;
  }

  async deactivateProjectConnection(id: string): Promise<ProjectConnection> {
    const now = new Date().toISOString();
    const current = this.projectConnections.find((item) => item.id === id);
    if (!current) throw new Error(`Project connection ${id} was not found.`);
    const deactivated = ProjectConnectionSchema.parse({
      ...current,
      active: false,
      status: "inactive",
      updatedAt: now
    });
    this.projectConnections = this.projectConnections.map((item) => (item.id === id ? deactivated : item));
    return deactivated;
  }

  async listTeamBusMessages(scope: StrictProjectScope): Promise<TeamBusMessage[]> {
    await this.assertProjectScope(scope);
    return this.teamBusMessages
      .filter((message) => sameScope(message, scope))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async addTeamBusMessage(scope: StrictProjectScope, input: TeamBusMessageInput): Promise<TeamBusMessage> {
    await this.assertProjectScope(scope);
    const message: TeamBusMessage = {
      id: input.id || createRecordId("bus"),
      ...scope,
      workItemId: input.workItemId,
      loopRunId: input.loopRunId,
      from: input.from,
      to: input.to || [],
      kind: input.kind,
      topic: input.topic,
      body: input.body,
      payload: input.payload || {},
      createdAt: nowIso()
    };
    this.teamBusMessages.push(message);
    return message;
  }

  async listLoopRuns(scope: StrictProjectScope): Promise<LoopRun[]> {
    await this.assertProjectScope(scope);
    return this.loopRuns
      .filter((run) => sameScope(run, scope))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async upsertLoopRun(scope: StrictProjectScope, input: LoopRunInput): Promise<LoopRun> {
    await this.assertProjectScope(scope);
    const now = nowIso();
    const existing = input.id ? this.loopRuns.find((run) => run.id === input.id && sameScope(run, scope)) : undefined;
    const run: LoopRun = {
      id: input.id || createRecordId("loop"),
      ...scope,
      workItemId: input.workItemId ?? existing?.workItemId,
      directionId: input.directionId ?? existing?.directionId,
      opportunityId: input.opportunityId ?? existing?.opportunityId,
      proposalId: input.proposalId ?? existing?.proposalId,
      status: input.status || existing?.status || "running",
      summary: input.summary || existing?.summary || "",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      closedAt: input.closedAt ?? existing?.closedAt
    };
    this.loopRuns = upsertByScopedId(this.loopRuns, run);
    return run;
  }

  async getDirection(scope: StrictProjectScope): Promise<Direction | null> {
    await this.assertProjectScope(scope);
    return this.directions.find((direction) => sameScope(direction, scope)) || null;
  }

  async upsertDirection(scope: StrictProjectScope, input: DirectionInput): Promise<Direction> {
    await this.assertProjectScope(scope);
    const now = nowIso();
    const existing = this.directions.find((direction) => sameScope(direction, scope));
    const direction: Direction = {
      id: input.id || existing?.id || createRecordId("direction"),
      ...scope,
      title: input.title,
      summary: input.summary,
      goals: input.goals || [],
      constraints: input.constraints || [],
      acceptanceCriteria: input.acceptanceCriteria || [],
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    this.directions = this.directions.filter((item) => !sameScope(item, scope));
    this.directions.push(direction);
    return direction;
  }

  async listOpportunities(scope: StrictProjectScope): Promise<Opportunity[]> {
    await this.assertProjectScope(scope);
    return this.opportunities
      .filter((opportunity) => sameScope(opportunity, scope))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async upsertOpportunity(scope: StrictProjectScope, input: OpportunityInput): Promise<Opportunity> {
    await this.assertProjectScope(scope);
    const now = nowIso();
    const existing = input.id
      ? this.opportunities.find((opportunity) => opportunity.id === input.id && sameScope(opportunity, scope))
      : undefined;
    const opportunity: Opportunity = {
      id: input.id || createRecordId("opp"),
      ...scope,
      workItemId: input.workItemId ?? existing?.workItemId,
      title: input.title,
      summary: input.summary,
      source: input.source || existing?.source || "operator",
      priority: input.priority || existing?.priority || "medium",
      status: input.status || existing?.status || "new",
      tags: input.tags || existing?.tags || [],
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    this.opportunities = upsertByScopedId(this.opportunities, opportunity);
    return opportunity;
  }

  async listOpportunityScanRuns(scope: StrictProjectScope): Promise<OpportunityScanRun[]> {
    await this.assertProjectScope(scope);
    return this.opportunityScanRuns
      .filter((scan) => sameScope(scan, scope))
      .sort((a, b) => Date.parse(b.completedAt || b.startedAt) - Date.parse(a.completedAt || a.startedAt));
  }

  async upsertOpportunityScanRun(
    scope: StrictProjectScope,
    input: OpportunityScanRunInput
  ): Promise<OpportunityScanRun> {
    await this.assertProjectScope(scope);
    const now = nowIso();
    const existing = input.id
      ? this.opportunityScanRuns.find((scan) => scan.id === input.id && sameScope(scan, scope))
      : undefined;
    const resolvedStatus = input.status ?? existing?.status ?? "complete";
    const scan = OpportunityScanRunSchema.parse({
      id: input.id ?? createRecordId("scan"),
      ...scope,
      status: resolvedStatus,
      sources: input.sources ?? existing?.sources ?? [],
      repoSha: input.repoSha ?? existing?.repoSha,
      memoryVersion: input.memoryVersion ?? existing?.memoryVersion,
      candidatesCreated: input.candidatesCreated ?? existing?.candidatesCreated ?? 0,
      summary: input.summary,
      startedAt: input.startedAt ?? existing?.startedAt ?? now,
      completedAt: input.completedAt ?? existing?.completedAt ?? (resolvedStatus === "running" ? undefined : now)
    });
    this.opportunityScanRuns = upsertByScopedId(this.opportunityScanRuns, scan);
    return scan;
  }

  async listProposals(scope: StrictProjectScope): Promise<Proposal[]> {
    await this.assertProjectScope(scope);
    return this.proposals
      .filter((proposal) => sameScope(proposal, scope))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async upsertProposal(scope: StrictProjectScope, input: ProposalInput): Promise<Proposal> {
    await this.assertProjectScope(scope);
    const now = nowIso();
    const existing = input.id
      ? this.proposals.find((proposal) => proposal.id === input.id && sameScope(proposal, scope))
      : undefined;
    const proposal: Proposal = {
      id: input.id || createRecordId("proposal"),
      ...scope,
      workItemId: input.workItemId ?? existing?.workItemId,
      loopRunId: input.loopRunId ?? existing?.loopRunId,
      opportunityId: input.opportunityId ?? existing?.opportunityId,
      title: input.title,
      summary: input.summary,
      researchFindings: input.researchFindings || existing?.researchFindings || [],
      options: input.options || existing?.options || [],
      recommendation: input.recommendation,
      acceptanceCriteria: input.acceptanceCriteria || existing?.acceptanceCriteria || [],
      implementationPlan: input.implementationPlan || existing?.implementationPlan || [],
      validationPlan: input.validationPlan || existing?.validationPlan || [],
      risks: input.risks || existing?.risks || [],
      status: input.status || existing?.status || "proposed",
      decision: existing?.decision,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    this.proposals = upsertByScopedId(this.proposals, proposal);
    return proposal;
  }

  async decideProposal(scope: StrictProjectScope, proposalId: string, input: ProposalDecisionInput): Promise<Proposal> {
    await this.assertProjectScope(scope);
    const proposal = this.proposals.find((item) => item.id === proposalId && sameScope(item, scope));
    if (!proposal) throw new Error(`Proposal ${proposalId} was not found for ${scope.projectId}.`);
    const now = nowIso();
    const decision: ProposalDecision = {
      decision: input.decision,
      decidedBy: input.decidedBy,
      reason: input.reason,
      requestedChanges: input.requestedChanges || [],
      decidedAt: now
    };
    const updated: Proposal = {
      ...proposal,
      status: decision.decision === "accept" ? "accepted" : decision.decision === "revise" ? "revising" : "rejected",
      decision,
      updatedAt: now
    };
    this.proposals = upsertByScopedId(this.proposals, updated);
    if (updated.loopRunId) {
      const loopRun = this.loopRuns.find((run) => run.id === updated.loopRunId && sameScope(run, scope));
      if (loopRun) {
        this.loopRuns = upsertByScopedId(this.loopRuns, {
          ...loopRun,
          proposalId: updated.id,
          status: loopStatusForProposalDecision(decision.decision),
          updatedAt: now
        });
      }
    }
    return updated;
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

  protected async assertProjectScope(scope: StrictProjectScope): Promise<void> {
    const connections = await this.listProjectConnections();
    const project = connections.find(
      (connection) => connection.projectId === scope.projectId && connection.repo === scope.repo
    );
    if (!project) throw new Error(`Connected project was not found for ${scope.projectId}/${scope.repo}.`);
    if (!project.active) throw new Error(`Project ${scope.repo} is not active.`);
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

  async close(): Promise<void> {
    await this.pool.end();
  }

  override async init(): Promise<void> {
    await this.pool.query(`
      create table if not exists work_items (
        id text primary key,
        payload jsonb not null,
        state text not null,
        state_changed_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table work_items add column if not exists state_changed_at timestamptz not null default now();
      create table if not exists stage_artifacts (
        id bigserial primary key,
        work_item_id text not null,
        artifact_key text,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );
      alter table stage_artifacts add column if not exists artifact_key text;
      create unique index if not exists stage_artifacts_artifact_key_idx on stage_artifacts (artifact_key) where artifact_key is not null;
      create table if not exists agent_events (
        sequence bigserial primary key,
        work_item_id text,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );
      create table if not exists memory_records (
        id text primary key,
        payload jsonb not null,
        key text,
        scope text not null,
        work_item_id text,
        importance integer not null,
        superseded_by text,
        updated_at timestamptz not null default now()
      );
      alter table memory_records add column if not exists key text;
      alter table memory_records add column if not exists superseded_by text;
      create unique index if not exists memory_records_live_key_idx
        on memory_records (
          scope,
          key,
          coalesce(payload->>'projectId', ''),
          coalesce(payload->>'repo', ''),
          coalesce(work_item_id, ''),
          coalesce(payload->>'agent', '')
        )
        where key is not null and superseded_by is null;
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
      create table if not exists team_bus_messages (
        id text primary key,
        project_id text not null,
        repo text not null,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );
      create table if not exists loop_runs (
        id text primary key,
        project_id text not null,
        repo text not null,
        payload jsonb not null,
        updated_at timestamptz not null default now()
      );
      create table if not exists project_directions (
        project_id text not null,
        repo text not null,
        payload jsonb not null,
        updated_at timestamptz not null default now(),
        primary key (project_id, repo)
      );
      create table if not exists opportunities (
        id text primary key,
        project_id text not null,
        repo text not null,
        payload jsonb not null,
        updated_at timestamptz not null default now()
      );
      create table if not exists opportunity_scan_runs (
        id text primary key,
        project_id text not null,
        repo text not null,
        payload jsonb not null,
        started_at timestamptz not null,
        completed_at timestamptz,
        updated_at timestamptz not null default now()
      );
      create index if not exists opportunity_scan_runs_project_repo_recency_idx
        on opportunity_scan_runs (project_id, repo, (coalesce(completed_at, started_at)) desc);
      create table if not exists proposals (
        id text primary key,
        project_id text not null,
        repo text not null,
        payload jsonb not null,
        updated_at timestamptz not null default now()
      );
    `);
    await this.seedProjectConnectionsFromConfig();
  }

  override async listWorkItems(): Promise<WorkItem[]> {
    const result = await this.pool.query("select payload from work_items order by updated_at desc");
    return result.rows.map((row) => WorkItemSchema.parse(row.payload));
  }

  override async getWorkItemWithArtifacts(
    id: string
  ): Promise<{ workItem: WorkItem; artifacts: StageArtifact[] } | null> {
    const workItemResult = await this.pool.query("select payload from work_items where id = $1", [id]);
    if (!workItemResult.rows[0]) return null;
    const artifactResult = await this.pool.query(
      "select payload from stage_artifacts where work_item_id = $1 order by created_at desc",
      [id]
    );
    return {
      workItem: WorkItemSchema.parse(workItemResult.rows[0].payload),
      artifacts: artifactResult.rows.map((row) => StageArtifactSchema.parse(row.payload))
    };
  }

  override async getStatus() {
    const workItems = await this.listWorkItems();
    const artifacts = await this.listArtifacts();
    const events = await this.listEvents(0, 50);
    const emergencyStop = await this.readEmergencyStopFlag();
    return buildControllerStatus({
      workItems,
      artifacts,
      events,
      projectConnections: await this.listProjectConnections(),
      emergencyStop: emergencyStop.active,
      emergencyReason: emergencyStop.reason
    });
  }

  override async createWorkItem(input: WorkItemCreateInput): Promise<WorkItem> {
    const workItem = await super.createWorkItem(input);
    await this.pool.query("insert into work_items (id, payload, state, state_changed_at) values ($1, $2, $3, $4)", [
      workItem.id,
      workItem,
      workItem.state,
      workItem.stateChangedAt
    ]);
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
    const stateChangedAt = currentItem.state === state ? currentItem.stateChangedAt || updatedAt : updatedAt;
    await this.pool.query(
      `update work_items
       set state = $2,
           payload = jsonb_set(
             jsonb_set(
               jsonb_set(payload, '{state}', to_jsonb($2::text), true),
               '{updatedAt}',
               to_jsonb($3::text),
               true
             ),
             '{stateChangedAt}',
             to_jsonb($4::text),
             true
           ),
           state_changed_at = $4::timestamptz,
           updated_at = now()
       where id = $1`,
      [id, state, updatedAt, stateChangedAt]
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
    const parsed = StageArtifactSchema.parse(artifact);
    const artifactKey = parsed.artifactId;
    await this.pool.query(
      `insert into stage_artifacts (work_item_id, payload, artifact_key, created_at)
       values ($1, $2, $3, $4)
       on conflict (artifact_key) where artifact_key is not null
       do update set payload = excluded.payload, created_at = excluded.created_at`,
      [parsed.workItemId, parsed, artifactKey, parsed.createdAt]
    );
    await super.addArtifact(parsed);
  }

  override async getArtifact(id: string): Promise<StageArtifact | null> {
    const result = await this.pool.query(
      "select payload from stage_artifacts where artifact_key = $1 or payload ->> 'artifactId' = $1 limit 1",
      [id]
    );
    return result.rows[0] ? StageArtifactSchema.parse(result.rows[0].payload) : null;
  }

  override async addEvent(
    event: Omit<AgentEvent, "sequence" | "createdAt"> & Partial<Pick<AgentEvent, "sequence" | "createdAt">>
  ): Promise<AgentEvent> {
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
    const result = await this.pool.query(
      "select payload from memory_records order by importance desc, updated_at desc"
    );
    const stored = result.rows.map((row) => MemoryRecordSchema.parse(row.payload));
    if (!workItemId) return stored.length ? stored : super.listMemories();

    const workItemResult = await this.pool.query("select payload from work_items where id = $1", [workItemId]);
    const workItem = workItemResult.rows[0] ? WorkItemSchema.parse(workItemResult.rows[0].payload) : null;
    if (workItem) return selectRelevantMemories(stored, workItem, 100);

    const filtered = stored.filter((memory) => memory.workItemId === workItemId);
    return filtered.length ? filtered : super.listMemories(workItemId);
  }

  override async addMemories(memories: MemoryRecord[]): Promise<void> {
    const parsed = memories.map((item) => MemoryRecordSchema.parse(item));
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      for (const memory of parsed) {
        if (isLiveKeyedMemory(memory)) {
          await client.query(
            `update memory_records
             set superseded_by = $1,
                 payload = jsonb_set(
                   jsonb_set(payload, '{supersededBy}', to_jsonb($1::text), true),
                   '{updatedAt}',
                   to_jsonb($8::text),
                   true
                 ),
                 updated_at = now()
             where id <> $1
               and key = $2
               and superseded_by is null
               and scope = $3
               and coalesce(payload->>'projectId', '') = $4
               and coalesce(payload->>'repo', '') = $5
               and coalesce(work_item_id, '') = $6
               and coalesce(payload->>'agent', '') = $7`,
            [
              memory.id,
              memory.key,
              memory.scope,
              memory.projectId || "",
              memory.repo || "",
              memory.workItemId || "",
              memory.agent || "",
              memory.updatedAt
            ]
          );
        }
        await client.query(
          `insert into memory_records (id, payload, key, scope, work_item_id, importance, superseded_by)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (id) do update set
             payload = excluded.payload,
             key = excluded.key,
             scope = excluded.scope,
             work_item_id = excluded.work_item_id,
             importance = excluded.importance,
             superseded_by = excluded.superseded_by,
             updated_at = now()`,
          [
            memory.id,
            memory,
            memory.key || null,
            memory.scope,
            memory.workItemId || null,
            memory.importance,
            memory.supersededBy || null
          ]
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    await super.addMemories(parsed);
  }

  override async listProjectConnections(): Promise<ProjectConnection[]> {
    const result = await this.pool.query(
      "select payload from project_connections order by active desc, updated_at desc"
    );
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

  override async deactivateProjectConnection(id: string): Promise<ProjectConnection> {
    const connections = await this.listProjectConnections();
    const current = connections.find((item) => item.id === id);
    if (!current) throw new Error(`Project connection ${id} was not found.`);
    const now = new Date().toISOString();
    const deactivated = ProjectConnectionSchema.parse({
      ...current,
      active: false,
      status: "inactive",
      updatedAt: now
    });
    await this.pool.query(
      `insert into project_connections (id, payload, active)
       values ($1, $2, false)
       on conflict (id) do update set payload = excluded.payload, active = false, updated_at = now()`,
      [deactivated.id, deactivated]
    );
    await super.upsertProjectConnection(deactivated);
    return deactivated;
  }

  override async listTeamBusMessages(scope: StrictProjectScope): Promise<TeamBusMessage[]> {
    await this.assertProjectScope(scope);
    const result = await this.pool.query(
      "select payload from team_bus_messages where project_id = $1 and repo = $2 order by created_at asc",
      [scope.projectId, scope.repo]
    );
    return result.rows.map((row) => row.payload as TeamBusMessage);
  }

  override async addTeamBusMessage(scope: StrictProjectScope, input: TeamBusMessageInput): Promise<TeamBusMessage> {
    const message = await super.addTeamBusMessage(scope, input);
    await this.pool.query(
      `insert into team_bus_messages (id, project_id, repo, payload, created_at)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update set payload = excluded.payload, project_id = excluded.project_id, repo = excluded.repo, created_at = excluded.created_at`,
      [scopedDbId(scope, message.id), message.projectId, message.repo, message, message.createdAt]
    );
    return message;
  }

  override async listLoopRuns(scope: StrictProjectScope): Promise<LoopRun[]> {
    await this.assertProjectScope(scope);
    const result = await this.pool.query(
      "select payload from loop_runs where project_id = $1 and repo = $2 order by updated_at desc",
      [scope.projectId, scope.repo]
    );
    return result.rows.map((row) => row.payload as LoopRun);
  }

  override async upsertLoopRun(scope: StrictProjectScope, input: LoopRunInput): Promise<LoopRun> {
    await this.assertProjectScope(scope);
    const now = nowIso();
    const existing = input.id ? (await this.listLoopRuns(scope)).find((run) => run.id === input.id) : undefined;
    const run: LoopRun = {
      id: input.id || createRecordId("loop"),
      ...scope,
      workItemId: input.workItemId ?? existing?.workItemId,
      directionId: input.directionId ?? existing?.directionId,
      opportunityId: input.opportunityId ?? existing?.opportunityId,
      proposalId: input.proposalId ?? existing?.proposalId,
      status: input.status || existing?.status || "running",
      summary: input.summary ?? existing?.summary ?? "",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      closedAt: input.closedAt ?? existing?.closedAt
    };
    await this.pool.query(
      `insert into loop_runs (id, project_id, repo, payload, updated_at)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update set payload = excluded.payload, project_id = excluded.project_id, repo = excluded.repo, updated_at = excluded.updated_at`,
      [scopedDbId(scope, run.id), run.projectId, run.repo, run, run.updatedAt]
    );
    return run;
  }

  override async getDirection(scope: StrictProjectScope): Promise<Direction | null> {
    await this.assertProjectScope(scope);
    const result = await this.pool.query("select payload from project_directions where project_id = $1 and repo = $2", [
      scope.projectId,
      scope.repo
    ]);
    return result.rows[0] ? (result.rows[0].payload as Direction) : null;
  }

  override async upsertDirection(scope: StrictProjectScope, input: DirectionInput): Promise<Direction> {
    const direction = await super.upsertDirection(scope, input);
    await this.pool.query(
      `insert into project_directions (project_id, repo, payload, updated_at)
       values ($1, $2, $3, $4)
       on conflict (project_id, repo) do update set payload = excluded.payload, updated_at = excluded.updated_at`,
      [direction.projectId, direction.repo, direction, direction.updatedAt]
    );
    return direction;
  }

  override async listOpportunities(scope: StrictProjectScope): Promise<Opportunity[]> {
    await this.assertProjectScope(scope);
    const result = await this.pool.query(
      "select payload from opportunities where project_id = $1 and repo = $2 order by updated_at desc",
      [scope.projectId, scope.repo]
    );
    return result.rows.map((row) => row.payload as Opportunity);
  }

  override async upsertOpportunity(scope: StrictProjectScope, input: OpportunityInput): Promise<Opportunity> {
    const opportunity = await super.upsertOpportunity(scope, input);
    await this.pool.query(
      `insert into opportunities (id, project_id, repo, payload, updated_at)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update set payload = excluded.payload, project_id = excluded.project_id, repo = excluded.repo, updated_at = excluded.updated_at`,
      [scopedDbId(scope, opportunity.id), opportunity.projectId, opportunity.repo, opportunity, opportunity.updatedAt]
    );
    return opportunity;
  }

  override async listOpportunityScanRuns(scope: StrictProjectScope): Promise<OpportunityScanRun[]> {
    await this.assertProjectScope(scope);
    const result = await this.pool.query(
      `select payload from opportunity_scan_runs
       where project_id = $1 and repo = $2
       order by coalesce(completed_at, started_at) desc`,
      [scope.projectId, scope.repo]
    );
    return result.rows.map((row) => OpportunityScanRunSchema.parse(row.payload));
  }

  override async upsertOpportunityScanRun(
    scope: StrictProjectScope,
    input: OpportunityScanRunInput
  ): Promise<OpportunityScanRun> {
    const existing = input.id ? await this.getStoredOpportunityScanRun(scope, input.id) : null;
    const mergedInput = existing
      ? {
          id: input.id ?? existing.id,
          status: input.status ?? existing.status,
          sources: input.sources ?? existing.sources,
          repoSha: input.repoSha ?? existing.repoSha,
          memoryVersion: input.memoryVersion ?? existing.memoryVersion,
          candidatesCreated: input.candidatesCreated ?? existing.candidatesCreated,
          summary: input.summary,
          startedAt: input.startedAt ?? existing.startedAt,
          completedAt: input.completedAt ?? existing.completedAt
        }
      : input;
    const scan = await super.upsertOpportunityScanRun(scope, mergedInput);
    if (existing && sameOpportunityScanRun(scan, existing)) return existing;
    await this.pool.query(
      `insert into opportunity_scan_runs (id, project_id, repo, payload, started_at, completed_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (id) do update set
         payload = excluded.payload,
         project_id = excluded.project_id,
         repo = excluded.repo,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at`,
      [scopedDbId(scope, scan.id), scan.projectId, scan.repo, scan, scan.startedAt, scan.completedAt || null]
    );
    return scan;
  }

  private async getStoredOpportunityScanRun(scope: StrictProjectScope, id: string): Promise<OpportunityScanRun | null> {
    const result = await this.pool.query(
      "select payload from opportunity_scan_runs where id = $1 and project_id = $2 and repo = $3",
      [scopedDbId(scope, id), scope.projectId, scope.repo]
    );
    return result.rows[0] ? OpportunityScanRunSchema.parse(result.rows[0].payload) : null;
  }

  override async listProposals(scope: StrictProjectScope): Promise<Proposal[]> {
    await this.assertProjectScope(scope);
    const result = await this.pool.query(
      "select payload from proposals where project_id = $1 and repo = $2 order by updated_at desc",
      [scope.projectId, scope.repo]
    );
    return result.rows.map((row) => row.payload as Proposal);
  }

  override async upsertProposal(scope: StrictProjectScope, input: ProposalInput): Promise<Proposal> {
    const proposal = await super.upsertProposal(scope, input);
    await this.pool.query(
      `insert into proposals (id, project_id, repo, payload, updated_at)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update set payload = excluded.payload, project_id = excluded.project_id, repo = excluded.repo, updated_at = excluded.updated_at`,
      [scopedDbId(scope, proposal.id), proposal.projectId, proposal.repo, proposal, proposal.updatedAt]
    );
    return proposal;
  }

  override async decideProposal(
    scope: StrictProjectScope,
    proposalId: string,
    input: ProposalDecisionInput
  ): Promise<Proposal> {
    const existing = await this.listProposals(scope);
    const proposal = existing.find((item) => item.id === proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} was not found for ${scope.projectId}.`);
    }
    const now = nowIso();
    const decision: ProposalDecision = {
      decision: input.decision,
      decidedBy: input.decidedBy,
      reason: input.reason,
      requestedChanges: input.requestedChanges || [],
      decidedAt: now
    };
    const updated: Proposal = {
      ...proposal,
      status: decision.decision === "accept" ? "accepted" : decision.decision === "revise" ? "revising" : "rejected",
      decision,
      updatedAt: now
    };
    await this.pool.query(
      "update proposals set payload = $2, updated_at = $3 where id = $1 and project_id = $4 and repo = $5",
      [scopedDbId(scope, updated.id), updated, updated.updatedAt, updated.projectId, updated.repo]
    );
    if (updated.loopRunId) {
      await this.upsertLoopRun(scope, {
        id: updated.loopRunId,
        proposalId: updated.id,
        status: loopStatusForProposalDecision(decision.decision)
      });
    }
    return updated;
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

function buildControllerStatus(input: {
  workItems: WorkItem[];
  artifacts: StageArtifact[];
  events: AgentEvent[];
  projectConnections: ProjectConnection[];
  emergencyStop: boolean;
  emergencyReason: string;
}): ControllerStatus {
  const projectTeams = buildProjectTeams(input.projectConnections, input.workItems);
  const agentTotals = summarizeAgents(projectTeams);
  return {
    system: {
      name: "AI Dev Team Controller",
      operational: !input.emergencyStop,
      emergencyStop: input.emergencyStop,
      queueDepth: countRunnableWorkItems(input.workItems),
      agentsOnline: agentTotals.online,
      agentsTotal: agentTotals.total,
      githubSync: projectTeams.length ? "release-gated" : "connect-repo",
      systemLoad: Math.min(
        100,
        input.workItems.filter((item) => item.state !== "CLOSED" && item.state !== "BLOCKED").length * 12
      ),
      executionMode: "ChatGPT Pro assisted",
      emergencyReason: input.emergencyReason,
      scheduler: DEFAULT_SCHEDULER_POLICY
    },
    projectTeams,
    pipeline: buildPipelineSummary(input.workItems),
    workItems: input.workItems,
    artifacts: input.artifacts,
    releaseReadiness: buildReleaseReadiness(input.artifacts),
    logs: buildStatusLogs(input.events, input.artifacts),
    sharedContext: buildSharedContextSummary(input.workItems, input.artifacts)
  };
}

function buildPipelineSummary(workItems: WorkItem[]): PipelineSummary {
  return {
    NEW: workItems.filter((item) => item.state === "NEW").length,
    INTAKE: workItems.filter((item) => item.state === "INTAKE").length,
    RND: workItems.filter((item) => item.state === "RND").length,
    PROPOSAL: workItems.filter((item) => item.state === "PROPOSAL").length,
    AWAITING_ACCEPTANCE: workItems.filter((item) => item.state === "AWAITING_ACCEPTANCE").length,
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
  return workItems.filter(
    (item) => item.state === "NEW" && dependenciesSatisfied(item, workItems) && workItemMatchesProject(item, project)
  ).length;
}

function workItemMatchesProject(workItem: WorkItem, project: ProjectConnection): boolean {
  return workItem.projectId === project.projectId || workItem.repo === project.repo;
}

function buildProjectTeams(projects: ProjectConnection[], workItems: WorkItem[]): ControllerStatus["projectTeams"] {
  return projects
    .filter((project) => project.active)
    .map((project) => {
      const activeWorkItems = workItems.filter(
        (item) => !["NEW", "CLOSED", "BLOCKED"].includes(item.state) && workItemMatchesProject(item, project)
      ).length;
      const capabilityStatuses = project.capabilities.length
        ? project.capabilities
        : fallbackProjectCapabilities(project);
      const hasAttention =
        project.status !== "connected" ||
        capabilityStatuses.some(
          (capability) => capability.enabled && ["needs_auth", "missing", "error"].includes(capability.status)
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
      status: project.ghAvailable ? (project.ghAuthed ? "ready" : "needs_auth") : "missing",
      summary: project.ghAvailable
        ? "gh is installed for deterministic GitHub operations."
        : "gh is not available in this runtime.",
      details: project.githubCliVersion ? [project.githubCliVersion] : []
    }),
    ProjectCapabilityStatusSchema.parse({
      id: "github-mcp",
      label: "GitHub MCP",
      kind: "github_mcp",
      enabled: project.githubMcpEnabled,
      status: !project.githubMcpEnabled
        ? "disabled"
        : project.githubMcpAvailable
          ? project.githubMcpAuthenticated
            ? "ready"
            : "needs_auth"
          : "missing",
      summary: project.githubMcpEnabled
        ? "Official GitHub MCP server is configured for on-demand toolsets."
        : "GitHub MCP is disabled for this project.",
      details: project.githubMcpVersion ? [project.githubMcpVersion] : []
    }),
    ProjectCapabilityStatusSchema.parse({
      id: "github-sdk",
      label: "GitHub SDK",
      kind: "github_sdk",
      enabled: true,
      status: project.githubSdkConnected ? "ready" : "needs_auth",
      summary: project.githubSdkConnected
        ? "Octokit can read this repository."
        : "Octokit needs a token that can read this repository.",
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

function buildReleaseReadiness(artifacts: StageArtifact[]): ReleaseReadinessSummary {
  const latestRelease = artifacts.find((artifact) => artifact.stage === "RELEASE");
  const testsRun = artifacts.flatMap((artifact) => artifact.testsRun);
  return {
    status: latestRelease?.releaseReadiness || "unknown",
    target: latestRelease?.workItemId || "No release candidate",
    checks: [
      ["Tests", testsRun.length ? `${testsRun.length} configured/run` : "No runs yet"],
      ["Security Scan", testsRun.some((test) => test.toLowerCase().includes("security")) ? "Recorded" : "Pending"],
      [
        "Privacy Review",
        artifacts.some((artifact) => artifact.risks.some((risk) => risk.toLowerCase().includes("privacy")))
          ? "Review required"
          : "No findings"
      ],
      ["GitHub Actions", "Pending remote PR"],
      ["Local/Remote Sync", "Checked by release gate"]
    ]
  };
}

function buildStatusLogs(events: AgentEvent[], artifacts: StageArtifact[]): StatusLogEntry[] {
  if (events.length) {
    return events
      .slice(-10)
      .reverse()
      .map((event) => [
        new Date(event.createdAt).toLocaleTimeString("en-US", { hour12: false }),
        event.level.toUpperCase(),
        event.ownerAgent || "system",
        event.message,
        event.workItemId || "-"
      ]);
  }

  return artifacts
    .slice(0, 10)
    .map((artifact) => [
      new Date(artifact.createdAt).toLocaleTimeString("en-US", { hour12: false }),
      artifact.status === "blocked" || artifact.status === "failed" ? "ERROR" : "INFO",
      artifact.ownerAgent,
      artifact.summary,
      artifact.workItemId
    ]);
}

function buildSharedContextSummary(workItems: WorkItem[], artifacts: StageArtifact[]): SharedContextSummary {
  return {
    activeThreads: buildActiveThreads(workItems, artifacts),
    research: artifacts
      .filter((artifact) => artifact.stage === "RND")
      .slice(0, 5)
      .map((artifact) => artifact.summary)
  };
}

function buildActiveThreads(workItems: WorkItem[], artifacts: StageArtifact[]): SharedContextSummary["activeThreads"] {
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
      webResearchEnabled:
        config.integrations.capabilityPacks.some((pack) => pack.name === "deep-web-research" && pack.enabled) ||
        config.integrations.mcpServers.some((server) => server.category === "web_search" && server.enabled),
      githubMcpEnabled: config.integrations.mcpServers.some((server) => server.category === "github" && server.enabled),
      githubWriteEnabled: false,
      active: true,
      memoryNamespace: config.project.isolation.memoryNamespace || projectId,
      contextDir: config.context.defaultContextDir,
      status: "connected",
      githubMcpAvailable: config.integrations.mcpServers.some(
        (server) =>
          server.category === "github" && server.transport === "stdio" && server.command === "github-mcp-server"
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
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  );
}

function resolveProjectScopeFromConnections(
  input: ProjectScope,
  connections: ProjectConnection[]
): ProjectScope | null {
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

function createRecordId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sameScope(value: StrictProjectScope, scope: StrictProjectScope): boolean {
  return value.projectId === scope.projectId && value.repo === scope.repo;
}

function upsertByScopedId<T extends StrictProjectScope & { id: string }>(items: T[], item: T): T[] {
  return [...items.filter((existing) => existing.id !== item.id || !sameScope(existing, item)), item];
}

function sameOpportunityScanRun(left: OpportunityScanRun, right: OpportunityScanRun): boolean {
  return (
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.repo === right.repo &&
    left.status === right.status &&
    JSON.stringify(left.sources) === JSON.stringify(right.sources) &&
    left.repoSha === right.repoSha &&
    left.memoryVersion === right.memoryVersion &&
    left.candidatesCreated === right.candidatesCreated &&
    left.summary === right.summary &&
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt
  );
}

function loopStatusForProposalDecision(decision: ProposalDecision["decision"]): LoopRun["status"] {
  if (decision === "reject") return "closed";
  return "running";
}

function scopedDbId(scope: StrictProjectScope, id: string): string {
  return `${scope.projectId}:${scope.repo}:${id}`;
}

function isLiveKeyedMemory(memory: MemoryRecord): boolean {
  return Boolean(memory.key && !memory.supersededBy);
}

function isSameLiveMemoryKey(left: MemoryRecord, right: MemoryRecord): boolean {
  return (
    isLiveKeyedMemory(left) &&
    isLiveKeyedMemory(right) &&
    left.key === right.key &&
    left.scope === right.scope &&
    (left.projectId || "") === (right.projectId || "") &&
    (left.repo || "") === (right.repo || "") &&
    (left.workItemId || "") === (right.workItemId || "") &&
    (left.agent || "") === (right.agent || "")
  );
}

function sortProjectConnections(connections: ProjectConnection[]): ProjectConnection[] {
  return [...connections].sort(
    (a, b) => Number(b.active) - Number(a.active) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  );
}

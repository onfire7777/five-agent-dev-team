import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Bot, CircleStop, Github, PlayCircle, RefreshCw, ShieldCheck, type LucideIcon } from "lucide-react";
import type {
  AgentRole,
  MemoryRecord,
  ProjectConnection,
  ProjectTeamStatus,
  StageArtifact,
  WorkItem
} from "../../../packages/shared/src";

declare const __DASHBOARD_API_BASE__: string | undefined;

type DashboardLog = [time: string, level: string, source: string, message: string, item?: string];

type Status = {
  system: {
    name: string;
    operational: boolean;
    emergencyStop: boolean;
    queueDepth: number;
    agentsOnline: number;
    agentsTotal: number;
    githubSync: string;
    systemLoad: number;
    executionMode?: string;
    emergencyReason: string;
    scheduler: {
      maxConcurrentAgentRuns: number;
      [key: string]: unknown;
    };
  };
  projectTeams: ProjectTeamStatus[];
  pipeline: Record<string, number>;
  workItems: WorkItem[];
  artifacts: StageArtifact[];
  releaseReadiness: {
    status: string;
    target: string;
    checks: Array<[string, string]>;
  };
  logs: DashboardLog[];
  sharedContext: {
    activeThreads: Array<[string, string, string]>;
    research: string[];
  };
};
type InsightView =
  | "release"
  | "direction"
  | "ideas"
  | "teamMessages"
  | "loopHistory"
  | "team"
  | "capabilities"
  | "memory"
  | "events";
type RequestType = "feature" | "bug" | "performance" | "security" | "privacy" | "refactor" | "research";
type Priority = "low" | "medium" | "high" | "urgent";
type RiskLevel = "low" | "medium" | "high";
type DetailFetchStatus = "idle" | "loading" | "ready" | "empty" | "unavailable" | "error";

type WorkDraft = {
  title: string;
  acceptanceCriteria: string;
  requestType: RequestType;
  priority: Priority;
  riskLevel: RiskLevel;
  frontendNeeded: boolean;
  backendNeeded: boolean;
  rndNeeded: boolean;
};

type ProjectDraft = {
  name: string;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  localPath: string;
  webResearchEnabled: boolean;
  githubMcpEnabled: boolean;
  githubWriteEnabled: boolean;
};

type ApiState = {
  connected: boolean;
  lastError: string;
};

type GitHubAccount = {
  connected: boolean;
  source: "env" | "local" | "none";
  sourceName?: string;
  login?: string;
  name?: string | null;
  avatarUrl?: string;
  scopes: string[];
  utilities: GitHubConnectedUtility[];
  clientIdConfigured: boolean;
  authFile?: string;
  message: string;
};

type GitHubConnectedUtility = {
  id: string;
  label: string;
  status: "ready" | "available" | "needs_scope" | "blocked";
  summary: string;
};

type GitHubDeviceSession = {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: string;
  interval: number;
  scope: string;
};

type GitHubConnectState = {
  status: "idle" | "starting" | "pending" | "connected" | "failed";
  message: string;
  session?: GitHubDeviceSession;
};

type AgentLane = {
  icon: LucideIcon;
  name: string;
  role: string;
  status: string;
  work: string;
  task: string;
  progress: number;
  tone: string;
};

type DetailListState<T> = {
  status: DetailFetchStatus;
  projectId: string;
  items: T[];
  message: string;
};

type DirectionDetailState = {
  status: DetailFetchStatus;
  projectId: string;
  direction?: ProjectDirection;
  message: string;
};

type ProposalDetailState = {
  status: DetailFetchStatus;
  workItemId: string;
  proposal?: ProposalArtifact;
  message: string;
};

type ProjectDirection = {
  id?: string;
  summary?: string;
  standingDirection?: string;
  nextLoopDirection?: string;
  currentPriority?: string;
  focus?: string;
  avoid?: string[];
  pauseNewLoopsAfterCurrent?: boolean;
  updatedAt?: string;
  createdAt?: string;
};

type OpportunityCandidate = {
  id: string;
  title?: string;
  summary?: string;
  source?: string;
  risk?: string;
  score?: number;
  status?: string;
  evidence?: string[];
  workItemId?: string;
  updatedAt?: string;
  createdAt?: string;
};

type ProposalArtifact = {
  id?: string;
  workItemId?: string;
  title?: string;
  problem?: string;
  researchSummary?: string;
  recommendedApproach?: string;
  status?: string;
  version?: number;
  risks?: string[];
  tasks?: string[];
  validationPlan?: string;
  rollbackPlan?: string;
  autoAcceptEligible?: boolean;
  updatedAt?: string;
};

type AgentMessage = {
  id?: string;
  type?: string;
  ownerAgent?: string;
  agent?: string;
  stage?: string;
  workItemId?: string;
  title?: string;
  summary?: string;
  message?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
};

type LoopRun = {
  id: string;
  workItemId?: string;
  triggerSource?: string;
  currentStage?: string;
  stage?: string;
  status?: string;
  blockingReason?: string;
  activeAgents?: string[];
  startRepoSha?: string;
  endRepoSha?: string;
  releaseState?: string;
  closureSummary?: string;
  nextRecommendedLoop?: string;
  startedAt?: string;
  closedAt?: string;
  updatedAt?: string;
};

const API_BASE =
  typeof __DASHBOARD_API_BASE__ === "string" && __DASHBOARD_API_BASE__
    ? __DASHBOARD_API_BASE__
    : "http://127.0.0.1:4310";

const pipelineStates = [
  "NEW",
  "INTAKE",
  "RND",
  "PROPOSAL",
  "AWAITING_ACCEPTANCE",
  "CONTRACT",
  "FRONTEND_BUILD",
  "BACKEND_BUILD",
  "INTEGRATION",
  "VERIFY",
  "RELEASE",
  "CLOSED",
  "BLOCKED"
] as const;

function createEmptyStatus(): Status {
  return {
    system: {
      name: "AI Dev Team Controller",
      operational: false,
      emergencyStop: false,
      queueDepth: 0,
      agentsOnline: 0,
      agentsTotal: 0,
      githubSync: "offline",
      systemLoad: 0,
      emergencyReason: "",
      scheduler: {
        maxConcurrentAgentRuns: 0
      }
    },
    pipeline: Object.fromEntries(pipelineStates.map((state) => [state, 0])),
    projectTeams: [],
    workItems: [],
    artifacts: [],
    releaseReadiness: {
      status: "offline",
      target: "Controller offline",
      checks: []
    },
    logs: [],
    sharedContext: {
      activeThreads: [],
      research: []
    }
  };
}

const roleLanes: Array<Omit<AgentLane, "status" | "work" | "task" | "progress"> & { agentRole: AgentRole }> = [
  {
    icon: Bot,
    name: "Product",
    role: "Product & Delivery",
    tone: "blue",
    agentRole: "product-delivery-orchestrator"
  },
  {
    icon: RefreshCw,
    name: "R&D",
    role: "Architecture",
    tone: "green",
    agentRole: "rnd-architecture-innovation"
  },
  {
    icon: PlayCircle,
    name: "Frontend",
    role: "UX Engineering",
    tone: "violet",
    agentRole: "frontend-ux-engineering"
  },
  {
    icon: CircleStop,
    name: "Backend",
    role: "Systems Engineering",
    tone: "slate",
    agentRole: "backend-systems-engineering"
  },
  {
    icon: ShieldCheck,
    name: "Quality",
    role: "Security & Release",
    tone: "amber",
    agentRole: "quality-security-privacy-release"
  }
];

const flowGroups = [
  { label: "Intake", states: ["NEW", "INTAKE"], icon: Bot },
  { label: "Research", states: ["RND", "PROPOSAL", "AWAITING_ACCEPTANCE", "CONTRACT"], icon: RefreshCw },
  { label: "Build", states: ["FRONTEND_BUILD", "BACKEND_BUILD", "INTEGRATION"], icon: PlayCircle },
  { label: "Verify", states: ["VERIFY", "BLOCKED"], icon: ShieldCheck },
  { label: "Release", states: ["RELEASE", "CLOSED"], icon: ShieldCheck }
] as const;

const insightOptions: Array<[InsightView, string]> = [
  ["release", "Release gate"],
  ["team", "Team lanes"],
  ["memory", "Memory"],
  ["events", "Events"]
];

const defaultGitHubAccount: GitHubAccount = {
  connected: false,
  source: "none",
  scopes: [],
  utilities: [],
  clientIdConfigured: false,
  message: "GitHub account status has not loaded yet."
};

const missingEndpointMessage = "This cooperative loop endpoint is not connected yet.";

function createListState<T>(): DetailListState<T> {
  return { status: "idle", projectId: "", items: [], message: "" };
}

function createDirectionState(): DirectionDetailState {
  return { status: "idle", projectId: "", message: "" };
}

function createProposalState(): ProposalDetailState {
  return { status: "idle", workItemId: "", message: "" };
}

export function App() {
  const [status, setStatus] = useState<Status>(() => createEmptyStatus());
  const [apiState, setApiState] = useState<ApiState>({
    connected: false,
    lastError: "Controller unavailable"
  });
  const [loading, setLoading] = useState(false);
  const [selectedWorkItem, setSelectedWorkItem] = useState("");
  const [activeInsight, setActiveInsight] = useState<InsightView>("release");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [projects, setProjects] = useState<ProjectConnection[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const selectedProjectIdRef = useRef("");
  const hydratedProjectIdRef = useRef("");
  const [createError, setCreateError] = useState("");
  const [projectError, setProjectError] = useState("");
  const [githubAccountError, setGithubAccountError] = useState("");
  const [githubAccount, setGithubAccount] = useState<GitHubAccount>(defaultGitHubAccount);
  const [githubConnect, setGithubConnect] = useState<GitHubConnectState>({
    status: "idle",
    message: ""
  });
  const [directionState, setDirectionState] = useState<DirectionDetailState>(() => createDirectionState());
  const [opportunitiesState, setOpportunitiesState] = useState<DetailListState<OpportunityCandidate>>(() =>
    createListState()
  );
  const [teamMessagesState, setTeamMessagesState] = useState<DetailListState<AgentMessage>>(() => createListState());
  const [loopRunsState, setLoopRunsState] = useState<DetailListState<LoopRun>>(() => createListState());
  const [proposalState, setProposalState] = useState<ProposalDetailState>(() => createProposalState());
  const [directionDraft, setDirectionDraft] = useState("");
  const [directionPause, setDirectionPause] = useState(false);
  const [proposalFeedback, setProposalFeedback] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [workDraft, setWorkDraft] = useState<WorkDraft>({
    title: "",
    acceptanceCriteria: "",
    requestType: "feature",
    priority: "medium",
    riskLevel: "medium",
    frontendNeeded: true,
    backendNeeded: true,
    rndNeeded: true
  });
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>({
    name: "",
    repoOwner: "",
    repoName: "",
    defaultBranch: "main",
    localPath: "",
    webResearchEnabled: true,
    githubMcpEnabled: true,
    githubWriteEnabled: false
  });

  function selectProjectId(projectId: string) {
    selectedProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    setSelectedWorkItem("");
    setDirectionState(createDirectionState());
    setOpportunitiesState(createListState());
    setTeamMessagesState(createListState());
    setLoopRunsState(createListState());
    setProposalState(createProposalState());
  }

  function hydrateProjectDraft(project: ProjectConnection, force = false) {
    if (!force && hydratedProjectIdRef.current === project.id) return;
    hydratedProjectIdRef.current = project.id;
    setProjectDraft((draft) => ({
      ...draft,
      name: project.name,
      repoOwner: project.repoOwner,
      repoName: project.repoName,
      defaultBranch: project.defaultBranch,
      localPath: project.localPath,
      webResearchEnabled: project.webResearchEnabled,
      githubMcpEnabled: project.githubMcpEnabled,
      githubWriteEnabled: project.githubWriteEnabled
    }));
  }

  async function loadStatus(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/api/status`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus(await response.json());
      setApiState({ connected: true, lastError: "" });
      try {
        const projectId = activeProjectIdFromState(projects, selectedProjectIdRef.current);
        await loadMemories(undefined, projectId || undefined);
      } catch {
        setMemories([]);
      }
      try {
        await loadProjects();
      } catch {
        setProjects([]);
      }
      try {
        await loadGithubAccount();
      } catch {
        setGithubAccount(defaultGitHubAccount);
      }
      return true;
    } catch (error) {
      setStatus(createEmptyStatus());
      setMemories([]);
      setProjects([]);
      setGithubAccount(defaultGitHubAccount);
      setApiState({
        connected: false,
        lastError: error instanceof Error ? error.message : "Controller unavailable"
      });
      return false;
    }
  }

  async function loadMemories(workItemId?: string, projectId?: string) {
    const url = new URL(`${API_BASE}/api/memories`);
    if (workItemId) url.searchParams.set("workItemId", workItemId);
    if (projectId) url.searchParams.set("projectId", projectId);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setMemories(await response.json());
  }

  async function loadGithubAccount() {
    const response = await fetch(`${API_BASE}/api/github/account`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const account = (await response.json()) as GitHubAccount;
    setGithubAccount(account);
    return account;
  }

  async function loadProjects() {
    const response = await fetch(`${API_BASE}/api/projects`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const nextProjects = (await response.json()) as ProjectConnection[];
    setProjects(nextProjects);
    const selectedId = selectedProjectIdRef.current;
    const active =
      nextProjects.find((project) => project.id === selectedId) ||
      nextProjects.find((project) => project.active) ||
      nextProjects[0];
    if (active) {
      selectProjectId(active.id);
      hydrateProjectDraft(active);
    }
  }

  async function postControl(path: string, body?: unknown) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw new Error(await readErrorMessage(response));
    return response.json();
  }

  async function fetchOptional(path: string) {
    try {
      const response = await fetch(`${API_BASE}${path}`);
      if (!response.ok) {
        const message = await readErrorMessage(response);
        return {
          ok: false as const,
          unavailable: response.status === 404 || response.status === 405,
          message: response.status === 404 || response.status === 405 ? missingEndpointMessage : message
        };
      }
      return { ok: true as const, data: await readResponseJson(response) };
    } catch (error) {
      return {
        ok: false as const,
        unavailable: false,
        message: error instanceof Error ? error.message : "Request failed."
      };
    }
  }

  async function postOptional(path: string, body?: unknown) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!response.ok) {
        const message = await readErrorMessage(response);
        return {
          ok: false as const,
          unavailable: response.status === 404 || response.status === 405,
          message: response.status === 404 || response.status === 405 ? missingEndpointMessage : message
        };
      }
      return { ok: true as const, data: await readResponseJson(response) };
    } catch (error) {
      return {
        ok: false as const,
        unavailable: false,
        message: error instanceof Error ? error.message : "Request failed."
      };
    }
  }

  async function loadDirection(projectId: string) {
    setDirectionState({ projectId, status: "loading", message: "" });
    const result = await fetchOptional(`/api/projects/${encodeURIComponent(projectId)}/direction`);
    if (!result.ok) {
      setDirectionState({
        projectId,
        status: result.unavailable ? "unavailable" : "error",
        message: result.message
      });
      return;
    }
    const direction = extractObject<ProjectDirection>(result.data, ["direction", "projectDirection"]);
    setDirectionState({
      projectId,
      direction,
      status: direction ? "ready" : "empty",
      message: direction ? "" : "No project direction has been saved yet."
    });
  }

  async function loadOpportunities(projectId: string) {
    setOpportunitiesState({ projectId, items: [], status: "loading", message: "" });
    const result = await fetchOptional(`/api/projects/${encodeURIComponent(projectId)}/opportunities`);
    if (!result.ok) {
      setOpportunitiesState({
        projectId,
        items: [],
        status: result.unavailable ? "unavailable" : "error",
        message: result.message
      });
      return;
    }
    const items = extractList<OpportunityCandidate>(result.data, ["opportunities", "candidates", "items"]);
    setOpportunitiesState({
      projectId,
      items,
      status: items.length ? "ready" : "empty",
      message: items.length ? "" : "No opportunities are waiting."
    });
  }

  async function loadTeamMessages(projectId: string) {
    setTeamMessagesState({ projectId, items: [], status: "loading", message: "" });
    const result = await fetchOptional(`/api/projects/${encodeURIComponent(projectId)}/team-bus`);
    if (!result.ok) {
      setTeamMessagesState({
        projectId,
        items: [],
        status: result.unavailable ? "unavailable" : "error",
        message: result.message
      });
      return;
    }
    const items = extractList<AgentMessage>(result.data, ["messages", "teamBus", "items"]);
    setTeamMessagesState({
      projectId,
      items,
      status: items.length ? "ready" : "empty",
      message: items.length ? "" : "No team messages yet."
    });
  }

  async function loadLoopRuns(projectId: string) {
    setLoopRunsState({ projectId, items: [], status: "loading", message: "" });
    const result = await fetchOptional(`/api/projects/${encodeURIComponent(projectId)}/loop-runs`);
    if (!result.ok) {
      setLoopRunsState({
        projectId,
        items: [],
        status: result.unavailable ? "unavailable" : "error",
        message: result.message
      });
      return;
    }
    const items = extractList<LoopRun>(result.data, ["loopRuns", "runs", "items"]);
    setLoopRunsState({
      projectId,
      items,
      status: items.length ? "ready" : "empty",
      message: items.length ? "" : "No loop history yet."
    });
  }

  async function loadProposal(workItemId?: string) {
    if (!workItemId) {
      setProposalState({ workItemId: "", status: "empty", message: "No selected work item has a proposal yet." });
      return;
    }
    setProposalState({ workItemId, status: "loading", message: "" });
    const result = await fetchOptional(`/api/work-items/${encodeURIComponent(workItemId)}/proposal`);
    if (!result.ok) {
      setProposalState({
        workItemId,
        status: result.unavailable ? "unavailable" : "error",
        message: result.unavailable ? "Proposal details are not available yet." : result.message
      });
      return;
    }
    const proposal = extractObject<ProposalArtifact>(result.data, ["proposal", "artifact"]);
    setProposalState({
      workItemId,
      proposal,
      status: proposal ? "ready" : "empty",
      message: proposal ? "" : "No proposal is attached to the selected work item."
    });
  }

  async function saveDirection(mode: "next_loop" | "standing") {
    const active =
      projects.find((project) => project.id === selectedProjectIdRef.current) ||
      projects.find((project) => project.active);
    if (!active || !directionDraft.trim()) return;
    setPendingAction(`direction-${mode}`);
    setDirectionState((state) => ({ ...state, projectId: active.projectId, status: "loading", message: "" }));
    try {
      const result = await postOptional(`/api/projects/${encodeURIComponent(active.projectId)}/direction`, {
        mode,
        instruction: directionDraft.trim(),
        pauseNewLoopsAfterCurrent: directionPause
      });
      if (!result.ok) {
        setDirectionState({
          projectId: active.projectId,
          direction: directionState.direction,
          status: result.unavailable ? "unavailable" : "error",
          message: result.message
        });
        return;
      }
      setDirectionDraft("");
      const direction = extractObject<ProjectDirection>(result.data, ["direction", "projectDirection"]) || {
        [mode === "standing" ? "standingDirection" : "nextLoopDirection"]: directionDraft.trim(),
        pauseNewLoopsAfterCurrent: directionPause,
        updatedAt: new Date().toISOString()
      };
      setDirectionState({
        projectId: active.projectId,
        direction,
        status: "ready",
        message: ""
      });
    } finally {
      setPendingAction("");
    }
  }

  async function scanOpportunities() {
    const projectId = activeProjectIdFromState(projects, selectedProjectIdRef.current);
    if (!projectId) return;
    setPendingAction("scan");
    setOpportunitiesState((state) => ({ ...state, projectId, status: "loading", message: "" }));
    try {
      const result = await postOptional(`/api/projects/${encodeURIComponent(projectId)}/opportunities/scan`);
      if (!result.ok) {
        setOpportunitiesState({
          projectId,
          items: [],
          status: result.unavailable ? "unavailable" : "error",
          message: result.message
        });
        return;
      }
      const items = extractList<OpportunityCandidate>(result.data, ["opportunities", "candidates", "items"]);
      if (items.length) {
        setOpportunitiesState({ projectId, items, status: "ready", message: "" });
      } else {
        await loadOpportunities(projectId);
      }
    } finally {
      setPendingAction("");
    }
  }

  async function promoteOpportunity(id: string) {
    if (pendingAction) return;
    setPendingAction(`promote-${id}`);
    try {
      const result = await postOptional(`/api/opportunities/${encodeURIComponent(id)}/promote`);
      if (!result.ok) {
        setOpportunitiesState((state) => ({
          ...state,
          status: result.unavailable ? "unavailable" : "error",
          message: result.message
        }));
        return;
      }
      const projectId = activeProjectIdFromState(projects, selectedProjectIdRef.current);
      if (projectId) await loadOpportunities(projectId);
      await refreshAll();
    } finally {
      setPendingAction("");
    }
  }

  async function decideProposal(decision: "accept" | "revise" | "reject") {
    const workItemId = proposalState.proposal?.workItemId || proposalState.workItemId;
    if (!workItemId || pendingAction) return;
    setPendingAction(`proposal-${decision}`);
    try {
      const result = await postOptional(`/api/work-items/${encodeURIComponent(workItemId)}/proposal/${decision}`, {
        feedback: proposalFeedback.trim() || undefined
      });
      if (!result.ok) {
        setProposalState((state) => ({
          ...state,
          status: result.unavailable ? "unavailable" : "error",
          message: result.message
        }));
        return;
      }
      setProposalFeedback("");
      await loadProposal(workItemId);
      await refreshAll();
    } finally {
      setPendingAction("");
    }
  }

  async function startGithubConnection() {
    setGithubAccountError("");
    setGithubConnect({ status: "starting", message: "Starting GitHub connection..." });
    try {
      const session = (await postControl("/api/github/device/start")) as GitHubDeviceSession;
      setGithubConnect({
        status: "pending",
        message: "Approve this app in GitHub, then this screen will finish automatically.",
        session
      });
    } catch (error) {
      setGithubConnect({
        status: "failed",
        message: error instanceof Error ? error.message : "GitHub connection could not start."
      });
    }
  }

  async function disconnectGithubAccount() {
    setGithubAccountError("");
    setLoading(true);
    try {
      const result = await postControl("/api/github/disconnect");
      if (result.account) setGithubAccount(result.account);
      if (!result.disconnected) setGithubAccountError(result.message || "GitHub auth is not dashboard-managed.");
      setGithubConnect({ status: "idle", message: "" });
      await loadStatus();
    } catch (error) {
      setGithubAccountError(error instanceof Error ? error.message : "GitHub disconnect failed.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshActiveDetails() {
    const projectId = activeProjectIdFromState(projects, selectedProjectIdRef.current);
    if (!apiState.connected || !projectId) return;
    if (activeInsight === "direction") {
      await loadDirection(projectId);
    } else if (activeInsight === "ideas") {
      await Promise.all([loadOpportunities(projectId), loadProposal(selectedWorkItem || undefined)]);
    } else if (activeInsight === "teamMessages") {
      await loadTeamMessages(projectId);
    } else if (activeInsight === "loopHistory") {
      await loadLoopRuns(projectId);
    } else if (activeInsight === "memory") {
      await loadMemories(undefined, projectId);
    }
  }

  async function refreshAll() {
    const connected = await loadStatus();
    if (connected) await refreshActiveDetails();
  }

  async function createWorkItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");
    const targetProject =
      projects.find((project) => project.id === selectedProjectIdRef.current) ||
      projects.find((project) => project.active);
    if (!targetProject) {
      setCreateError("Connect a GitHub repo before starting autonomous work.");
      return;
    }
    if (!workDraft.title.trim()) {
      setCreateError("Title is required.");
      return;
    }
    setLoading(true);
    try {
      const response = await postControl("/api/work-items", {
        title: workDraft.title.trim(),
        requestType: workDraft.requestType,
        priority: workDraft.priority,
        riskLevel: workDraft.riskLevel,
        frontendNeeded: workDraft.frontendNeeded,
        backendNeeded: workDraft.backendNeeded,
        rndNeeded: workDraft.rndNeeded,
        projectId: targetProject.projectId,
        repo: targetProject.repo,
        acceptanceCriteria: workDraft.acceptanceCriteria
          .split(/\r?\n|;/)
          .map((item) => item.trim())
          .filter(Boolean)
      });
      setSelectedWorkItem(response.workItem.id);
      setWorkDraft((draft) => ({ ...draft, title: "", acceptanceCriteria: "" }));
      await refreshAll();
      if (response.blocked) setCreateError(response.reason || "Queued while emergency stop is active.");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Work item creation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function connectProject() {
    setProjectError("");
    if (!projectDraft.repoOwner.trim() || !projectDraft.repoName.trim() || !projectDraft.localPath.trim()) {
      setProjectError("Repo owner, repo name, and local path are required.");
      return;
    }
    setLoading(true);
    try {
      const project = (await postControl("/api/projects", {
        name: projectDraft.name.trim() || `${projectDraft.repoOwner.trim()}/${projectDraft.repoName.trim()}`,
        repoOwner: projectDraft.repoOwner.trim(),
        repoName: projectDraft.repoName.trim(),
        defaultBranch: projectDraft.defaultBranch.trim() || "main",
        localPath: projectDraft.localPath.trim(),
        webResearchEnabled: projectDraft.webResearchEnabled,
        githubMcpEnabled: projectDraft.githubMcpEnabled,
        githubWriteEnabled: projectDraft.githubWriteEnabled,
        active: true
      })) as ProjectConnection;
      selectProjectId(project.id);
      await loadProjects();
      await refreshAll();
      if (project.validationErrors.length) {
        setProjectError(project.validationErrors[0]);
      }
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Project connection failed.");
    } finally {
      setLoading(false);
    }
  }

  async function activateProject(projectId: string) {
    setProjectError("");
    setLoading(true);
    try {
      const project = (await postControl(
        `/api/projects/${encodeURIComponent(projectId)}/activate`
      )) as ProjectConnection;
      selectProjectId(project.id);
      hydrateProjectDraft(project, true);
      await loadProjects();
      await refreshAll();
      if (project.validationErrors.length) setProjectError(project.validationErrors[0]);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Project activation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleEmergencyStop() {
    setLoading(true);
    try {
      const path = status.system.emergencyStop ? "/api/emergency-resume" : "/api/emergency-stop";
      await postControl(path, { scope: "global", reason: "Operator dashboard control" });
      await refreshAll();
    } catch {
      setApiState({
        connected: false,
        lastError: "Emergency control request failed"
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    loadGithubAccount().catch(() => setGithubAccount(defaultGitHubAccount));
    const timer = window.setInterval(refreshAll, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (githubConnect.status !== "pending" || !githubConnect.session) return undefined;
    const timer = window.setTimeout(
      async () => {
        try {
          const result = (await postControl("/api/github/device/poll", {
            sessionId: githubConnect.session?.sessionId
          })) as {
            status: "pending" | "connected" | "expired" | "denied" | "failed";
            interval?: number;
            message?: string;
            account?: GitHubAccount;
          };
          if (result.status === "connected" && result.account) {
            setGithubAccount(result.account);
            setGithubConnect({
              status: "connected",
              message: "GitHub account connected. Repo checks now use the same account."
            });
            await refreshAll();
            return;
          }
          if (result.status === "pending") {
            setGithubConnect((current) => ({
              ...current,
              message: result.message || current.message,
              session: current.session
                ? {
                    ...current.session,
                    interval: result.interval || current.session.interval
                  }
                : current.session
            }));
            return;
          }
          setGithubConnect({
            status: "failed",
            message: result.message || "GitHub connection did not complete."
          });
        } catch (error) {
          setGithubConnect({
            status: "failed",
            message: error instanceof Error ? error.message : "GitHub polling failed."
          });
        }
      },
      Math.max(githubConnect.session.interval, 5) * 1000
    );
    return () => window.clearTimeout(timer);
  }, [githubConnect]);

  useEffect(() => {
    if (!("EventSource" in window)) return undefined;
    const projectId = activeProjectIdFromState(projects, selectedProjectIdRef.current);
    const url = new URL(`${API_BASE}/api/events/stream`);
    if (projectId) url.searchParams.set("projectId", projectId);
    const source = new EventSource(url);
    source.addEventListener("agent-event", () => {
      refreshAll();
    });
    return () => source.close();
  }, [projects, selectedProjectId]);

  const agentRows = useMemo(() => deriveAgentRows(status, apiState.connected), [status, apiState.connected]);
  const releaseReady = apiState.connected && status.releaseReadiness.status === "ready";
  const visibleMemories = memories.slice(0, 3);
  const visibleEvents = status.logs.slice(0, 4);
  const pipeline = status.pipeline as Record<string, number>;
  const activeProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || projects.find((project) => project.active),
    [projects, selectedProjectId]
  );
  const activeWorkItems = useMemo(
    () =>
      status.workItems
        .filter(
          (item) =>
            item.state !== "CLOSED" &&
            (!activeProject || item.projectId === activeProject.projectId || item.repo === activeProject.repo)
        )
        .slice(0, 5),
    [status.workItems, activeProject]
  );
  const activeTeam = useMemo(
    () => (activeProject ? status.projectTeams.find((team) => team.projectId === activeProject.projectId) : undefined),
    [status.projectTeams, activeProject]
  );
  const selected = useMemo(
    () => activeWorkItems.find((item) => item.id === selectedWorkItem) || activeWorkItems[0],
    [selectedWorkItem, activeWorkItems]
  );
  const systemState = systemPresentation(status, apiState);
  const apiMessage = apiNotice(apiState);
  const connectedGithubUtilities = githubAccount.utilities.filter(
    (utility) => utility.status === "ready" || utility.status === "available"
  );
  const githubUtilityPreview = connectedGithubUtilities.slice(0, 5);

  useEffect(() => {
    if (!apiState.connected || !activeProject) return;
    const projectId = activeProject.projectId;
    if (activeInsight === "direction") {
      loadDirection(projectId);
    } else if (activeInsight === "ideas") {
      loadOpportunities(projectId);
      loadProposal(selected?.id);
    } else if (activeInsight === "teamMessages") {
      loadTeamMessages(projectId);
    } else if (activeInsight === "loopHistory") {
      loadLoopRuns(projectId);
    }
  }, [activeInsight, activeProject?.projectId, selected?.id, apiState.connected]);

  return (
    <div className="app-shell">
      <header className="top-header">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Bot size={18} />
          </span>
          <div>
            <span>AI Dev Team</span>
            <h1>Autonomous Control</h1>
          </div>
        </div>

        <div className="system-line" aria-label="Runtime state">
          <span className={`status-pill ${systemState.className}`}>
            <span className={`dot ${systemState.dot}`} />
            {systemState.label}
          </span>
          <span>Queue {status.system.queueDepth}</span>
          <span>{status.projectTeams.length} teams</span>
          <span>
            {status.system.agentsOnline}/{status.system.agentsTotal} agents
          </span>
          <span>{status.system.scheduler.maxConcurrentAgentRuns} parallel</span>
          <span>{apiState.connected ? status.system.githubSync : "offline"}</span>
        </div>

        <div className="header-actions">
          <button
            className="icon-button"
            onClick={refreshAll}
            disabled={loading}
            data-testid="refresh-state"
            aria-label="Refresh"
          >
            <RefreshCw size={16} />
            <span>Refresh</span>
          </button>
          <button
            className={`stop-button ${status.system.emergencyStop ? "is-resume" : ""}`}
            onClick={toggleEmergencyStop}
            disabled={loading || !apiState.connected}
            data-testid="emergency-toggle"
            aria-label={status.system.emergencyStop ? "Resume autonomous agents" : "Emergency stop autonomous agents"}
          >
            {status.system.emergencyStop ? <PlayCircle size={16} /> : <CircleStop size={16} />}
            {status.system.emergencyStop ? "Resume" : "Stop"}
          </button>
        </div>
      </header>

      <main className="page">
        {(apiMessage || status.system.emergencyReason) && (
          <div className="notice" role="status">
            <ShieldCheck size={16} />
            <span>{status.system.emergencyReason || apiMessage}</span>
          </div>
        )}

        <section className="command-panel" aria-labelledby="create-work-title" data-testid="work-intake">
          <h2 className="sr-only" id="create-work-title">
            Create work
          </h2>
          <div className="section-label">
            <span>Command</span>
            <strong>{activeProject ? activeProject.repo : "Connect project first"}</strong>
          </div>

          <form className="command-form" onSubmit={createWorkItem}>
            <label className="field command-title">
              <span>Work item</span>
              <textarea
                value={workDraft.title}
                onChange={(event) => setWorkDraft((draft) => ({ ...draft, title: event.target.value }))}
                placeholder="Describe the work to run..."
                data-testid="work-title"
                aria-invalid={Boolean(createError)}
                aria-describedby={createError ? "work-title-error" : undefined}
              />
            </label>
            <button
              className="primary-button"
              type="submit"
              disabled={loading || !apiState.connected || !activeProject}
              data-testid="start-loop"
            >
              <PlayCircle size={16} />
              Start
            </button>

            <details className="options-menu">
              <summary>Work options</summary>
              <div className="options-grid">
                <label className="field">
                  <span>Type</span>
                  <select
                    value={workDraft.requestType}
                    onChange={(event) =>
                      setWorkDraft((draft) => ({ ...draft, requestType: event.target.value as RequestType }))
                    }
                  >
                    <option value="feature">Feature</option>
                    <option value="bug">Bug</option>
                    <option value="performance">Performance</option>
                    <option value="security">Security</option>
                    <option value="privacy">Privacy</option>
                    <option value="refactor">Refactor</option>
                    <option value="research">Research</option>
                  </select>
                </label>
                <label className="field">
                  <span>Priority</span>
                  <select
                    value={workDraft.priority}
                    onChange={(event) =>
                      setWorkDraft((draft) => ({ ...draft, priority: event.target.value as Priority }))
                    }
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
                <label className="field">
                  <span>Risk</span>
                  <select
                    value={workDraft.riskLevel}
                    onChange={(event) =>
                      setWorkDraft((draft) => ({ ...draft, riskLevel: event.target.value as RiskLevel }))
                    }
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="field criteria-field">
                  <span>Acceptance criteria</span>
                  <textarea
                    value={workDraft.acceptanceCriteria}
                    onChange={(event) =>
                      setWorkDraft((draft) => ({ ...draft, acceptanceCriteria: event.target.value }))
                    }
                    placeholder="One criterion per line or semicolon..."
                  />
                </label>
                <div className="route-toggles" aria-label="Agent routing">
                  <label className="route-toggle">
                    <input
                      type="checkbox"
                      checked={workDraft.frontendNeeded}
                      onChange={(event) =>
                        setWorkDraft((draft) => ({ ...draft, frontendNeeded: event.target.checked }))
                      }
                    />
                    <span>Frontend</span>
                  </label>
                  <label className="route-toggle">
                    <input
                      type="checkbox"
                      checked={workDraft.backendNeeded}
                      onChange={(event) => setWorkDraft((draft) => ({ ...draft, backendNeeded: event.target.checked }))}
                    />
                    <span>Backend</span>
                  </label>
                  <label className="route-toggle">
                    <input
                      type="checkbox"
                      checked={workDraft.rndNeeded}
                      onChange={(event) => setWorkDraft((draft) => ({ ...draft, rndNeeded: event.target.checked }))}
                    />
                    <span>R&D</span>
                  </label>
                </div>
              </div>
            </details>

            <details className="options-menu">
              <summary>Project</summary>
              <div
                className="project-grid"
                data-testid="project-connection"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    connectProject();
                  }
                }}
              >
                <div className="project-current">
                  <span className={`project-status ${activeProject?.status === "connected" ? "ready" : "attention"}`}>
                    <Github size={15} />
                    {activeProject ? activeProject.status.replace(/_/g, " ") : "No repo connected"}
                  </span>
                  <strong>{activeProject?.name || "Connect an isolated GitHub repo"}</strong>
                  <small>
                    {activeProject
                      ? `${activeProject.repo} · ${activeProject.localPath}`
                      : "Each repo gets its own five-agent team, memory namespace, GitHub stack, MCP tools, and work queue scope."}
                  </small>
                  {activeProject && (
                    <div className="project-badges" aria-label="Project capabilities">
                      <span>{activeProject.ghAuthed ? "CLI ready" : "CLI auth needed"}</span>
                      <span>
                        {activeProject.githubMcpAuthenticated
                          ? "MCP ready"
                          : activeProject.githubMcpEnabled
                            ? "MCP auth needed"
                            : "MCP off"}
                      </span>
                      <span>{activeProject.githubSdkConnected ? "SDK ready" : "SDK auth needed"}</span>
                      <span>
                        {activeTeam ? `${activeTeam.agentsOnline}/${activeTeam.agentsTotal} agents` : "5-agent team"}
                      </span>
                      <span>{activeProject.webResearchEnabled ? "Deep research" : "Research off"}</span>
                    </div>
                  )}
                </div>

                <div
                  className={`github-account-card ${githubAccount.connected ? "ready" : "attention"}`}
                  data-testid="github-account-card"
                >
                  <div className="github-account-main">
                    {githubAccount.avatarUrl ? (
                      <img className="github-account-avatar" src={githubAccount.avatarUrl} alt="" />
                    ) : (
                      <span className="github-account-avatar fallback">
                        <Github size={16} />
                      </span>
                    )}
                    <span>
                      <strong>
                        {githubAccount.connected ? `GitHub: ${githubAccount.login}` : "Connect GitHub account"}
                      </strong>
                      <small>
                        {githubAccount.connected
                          ? `${githubAccount.source === "local" ? "Dashboard OAuth" : githubAccount.sourceName || "Environment"} powers ${connectedGithubUtilities.length || "GitHub"} utilities.`
                          : githubAccount.message}
                      </small>
                      {githubUtilityPreview.length > 0 && (
                        <span className="github-utility-preview" aria-label="Connected GitHub utilities">
                          {githubUtilityPreview.map((utility) => (
                            <i key={utility.id}>{utility.label}</i>
                          ))}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="github-account-actions">
                    {githubConnect.status === "pending" && githubConnect.session ? (
                      <>
                        <span className="github-connect-code" aria-label="GitHub verification code">
                          {githubConnect.session.userCode}
                        </span>
                        <a
                          className="secondary-link"
                          href={githubConnect.session.verificationUriComplete || githubConnect.session.verificationUri}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Github size={14} />
                          Open GitHub
                        </a>
                      </>
                    ) : githubAccount.connected ? (
                      githubAccount.source === "local" ? (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={disconnectGithubAccount}
                          disabled={loading}
                        >
                          <CircleStop size={15} />
                          Disconnect
                        </button>
                      ) : (
                        <span className="github-managed">Env managed</span>
                      )
                    ) : (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={startGithubConnection}
                        disabled={
                          loading ||
                          githubConnect.status === "starting" ||
                          !apiState.connected ||
                          !githubAccount.clientIdConfigured
                        }
                      >
                        <Github size={15} />
                        {githubAccount.clientIdConfigured ? "Connect GitHub" : "OAuth setup needed"}
                      </button>
                    )}
                  </div>
                  {(githubConnect.message || githubAccountError) && (
                    <small
                      className={
                        githubConnect.status === "failed" || githubAccountError
                          ? "github-account-message error"
                          : "github-account-message"
                      }
                    >
                      {githubAccountError || githubConnect.message}
                    </small>
                  )}
                  {githubAccount.utilities.length > 0 && (
                    <details className="github-utilities">
                      <summary>Connected utilities</summary>
                      <div>
                        {githubAccount.utilities.map((utility) => (
                          <span className={`github-utility ${utility.status}`} key={utility.id} title={utility.summary}>
                            <strong>{utility.label}</strong>
                            <em>{utility.status.replace(/_/g, " ")}</em>
                          </span>
                        ))}
                      </div>
                    </details>
                  )}
                </div>

                <label className="field">
                  <span>Project name</span>
                  <input
                    value={projectDraft.name}
                    onChange={(event) => setProjectDraft((draft) => ({ ...draft, name: event.target.value }))}
                    placeholder="Optional display name"
                  />
                </label>
                <label className="field">
                  <span>Owner</span>
                  <input
                    value={projectDraft.repoOwner}
                    onChange={(event) => setProjectDraft((draft) => ({ ...draft, repoOwner: event.target.value }))}
                    placeholder="GitHub owner"
                  />
                </label>
                <label className="field">
                  <span>Repo</span>
                  <input
                    value={projectDraft.repoName}
                    onChange={(event) => setProjectDraft((draft) => ({ ...draft, repoName: event.target.value }))}
                    placeholder="Repository name"
                  />
                </label>
                <label className="field">
                  <span>Branch</span>
                  <input
                    value={projectDraft.defaultBranch}
                    onChange={(event) => setProjectDraft((draft) => ({ ...draft, defaultBranch: event.target.value }))}
                    placeholder="main"
                  />
                </label>
                <label className="field project-path">
                  <span>Local repo path</span>
                  <input
                    value={projectDraft.localPath}
                    onChange={(event) => setProjectDraft((draft) => ({ ...draft, localPath: event.target.value }))}
                    placeholder="C:\\Users\\you\\Desktop\\repo"
                  />
                </label>

                <div className="project-switches">
                  <label>
                    <input
                      type="checkbox"
                      checked={projectDraft.githubMcpEnabled}
                      onChange={(event) =>
                        setProjectDraft((draft) => ({ ...draft, githubMcpEnabled: event.target.checked }))
                      }
                    />
                    <span>GitHub MCP</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={projectDraft.githubWriteEnabled}
                      onChange={(event) =>
                        setProjectDraft((draft) => ({ ...draft, githubWriteEnabled: event.target.checked }))
                      }
                    />
                    <span>MCP writes</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={projectDraft.webResearchEnabled}
                      onChange={(event) =>
                        setProjectDraft((draft) => ({ ...draft, webResearchEnabled: event.target.checked }))
                      }
                    />
                    <span>Deep research</span>
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={connectProject}
                    disabled={loading || !apiState.connected}
                  >
                    <Github size={15} />
                    Connect
                  </button>
                </div>

                {projects.length > 1 && (
                  <div className="project-list">
                    {projects.map((project) => (
                      <button
                        type="button"
                        key={project.id}
                        className={activeProject?.id === project.id ? "is-active" : ""}
                        onClick={() => {
                          selectProjectId(project.id);
                          hydrateProjectDraft(project, true);
                          if (!project.active) activateProject(project.id);
                        }}
                        disabled={loading}
                      >
                        <span>{project.name}</span>
                        <small>
                          {project.repo} · {project.active ? "team enabled" : "inactive"}
                        </small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </form>
          {createError && (
            <p className="form-error" id="work-title-error" role="alert">
              {createError}
            </p>
          )}
          {projectError && (
            <p className="form-error" role="alert">
              {projectError}
            </p>
          )}
        </section>

        <div className="workspace-grid">
          <section className="flow-panel" aria-labelledby="workflow-title" data-testid="active-loop">
            <div className="panel-heading">
              <div>
                <span>Workflow</span>
                <h2 id="workflow-title">Current loop</h2>
              </div>
              <small>{activeWorkItems.length ? `${activeWorkItems.length} active` : "No active work"}</small>
            </div>

            <div className="flow-rail">
              {flowGroups.map(({ label, states, icon: Icon }) => {
                const count = states.reduce((total, state) => total + (pipeline[state] ?? 0), 0);
                return (
                  <div className={`flow-node ${count ? "has-work" : ""}`} key={label}>
                    <span>
                      <Icon size={15} />
                    </span>
                    <strong>{label}</strong>
                    <em>{count}</em>
                  </div>
                );
              })}
            </div>

            <div className="work-list">
              {activeWorkItems.length ? (
                activeWorkItems.map((item) => (
                  <button
                    className={`work-card ${selected?.id === item.id ? "is-selected" : ""}`}
                    key={item.id}
                    onClick={() => setSelectedWorkItem(item.id)}
                    data-testid={`work-card-${item.id}`}
                    aria-pressed={selected?.id === item.id}
                  >
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.id}</small>
                    </span>
                    <em>{item.state}</em>
                  </button>
                ))
              ) : (
                <div className="empty-state">No active work items.</div>
              )}
            </div>

            {selected && (
              <div className="selected-strip">
                <span className="state-chip">{selected.state}</span>
                <strong>{selected.title}</strong>
                <details>
                  <summary>Acceptance</summary>
                  <ul>
                    {selected.acceptanceCriteria.length ? (
                      selected.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)
                    ) : (
                      <li>Acceptance criteria pending.</li>
                    )}
                  </ul>
                </details>
              </div>
            )}
          </section>

          <aside className="insight-panel" aria-labelledby="insight-title">
            <div className="panel-heading compact">
              <div>
                <span>Insights</span>
                <h2 id="insight-title">Details</h2>
              </div>
              <label className="insight-select">
                <span className="sr-only">Insight view</span>
                <select
                  value={activeInsight}
                  onChange={(event) => setActiveInsight(event.target.value as InsightView)}
                  data-testid="insight-select"
                >
                  {insightOptions.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {renderInsight(activeInsight, {
              agentRows,
              releaseReady,
              status,
              visibleMemories,
              visibleEvents,
              activeProject,
              directionState,
              directionDraft,
              directionPause,
              opportunitiesState,
              teamMessagesState,
              loopRunsState,
              proposalState,
              proposalFeedback,
              pendingAction,
              onDirectionDraftChange: setDirectionDraft,
              onDirectionPauseChange: setDirectionPause,
              onSaveDirection: saveDirection,
              onScanOpportunities: scanOpportunities,
              onPromoteOpportunity: promoteOpportunity,
              onProposalFeedbackChange: setProposalFeedback,
              onProposalDecision: decideProposal
            })}
          </aside>
        </div>
      </main>
    </div>
  );
}

function renderInsight(
  activeInsight: InsightView,
  input: {
    agentRows: AgentLane[];
    releaseReady: boolean;
    status: Status;
    visibleMemories: MemoryRecord[];
    visibleEvents: Status["logs"];
    activeProject?: ProjectConnection;
    directionState: DirectionDetailState;
    directionDraft: string;
    directionPause: boolean;
    opportunitiesState: DetailListState<OpportunityCandidate>;
    teamMessagesState: DetailListState<AgentMessage>;
    loopRunsState: DetailListState<LoopRun>;
    proposalState: ProposalDetailState;
    proposalFeedback: string;
    pendingAction: string;
    onDirectionDraftChange: (value: string) => void;
    onDirectionPauseChange: (value: boolean) => void;
    onSaveDirection: (mode: "next_loop" | "standing") => void;
    onScanOpportunities: () => void;
    onPromoteOpportunity: (id: string) => void;
    onProposalFeedbackChange: (value: string) => void;
    onProposalDecision: (decision: "accept" | "revise" | "reject") => void;
  }
) {
  const {
    agentRows,
    releaseReady,
    status,
    visibleMemories,
    visibleEvents,
    activeProject,
    directionState,
    directionDraft,
    directionPause,
    opportunitiesState,
    teamMessagesState,
    loopRunsState,
    proposalState,
    proposalFeedback,
    pendingAction,
    onDirectionDraftChange,
    onDirectionPauseChange,
    onSaveDirection,
    onScanOpportunities,
    onPromoteOpportunity,
    onProposalFeedbackChange,
    onProposalDecision
  } = input;

  if (activeInsight === "direction") {
    const direction = directionState.direction;
    return (
      <div className="direction-panel" data-testid="direction-panel">
        <div className="insight-inline-header">
          <span className="insight-kicker">
            <ShieldCheck size={14} /> Project steering
          </span>
          <small>{activeProject?.repo || "No project"}</small>
        </div>
        {activeProject ? (
          <>
            {direction ? (
              <div className="direction-current">
                <strong>{direction.summary || direction.currentPriority || "Current direction"}</strong>
                <p>
                  {direction.standingDirection ||
                    direction.nextLoopDirection ||
                    direction.focus ||
                    "Direction exists, but no summary was provided."}
                </p>
                <div className="micro-meta">
                  {direction.currentPriority && <span>Priority: {direction.currentPriority}</span>}
                  {direction.focus && <span>Focus: {direction.focus}</span>}
                  {direction.pauseNewLoopsAfterCurrent && <span>Pause after current loop</span>}
                  {direction.updatedAt && <span>{formatDate(direction.updatedAt)}</span>}
                </div>
                {direction.avoid?.length ? (
                  <details className="compact-disclosure">
                    <summary>Avoid</summary>
                    <ul>
                      {direction.avoid.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : (
              <DetailEmpty state={directionState} fallback="No direction saved yet." />
            )}
            <label className="direction-input">
              <span>Guide the team</span>
              <textarea
                value={directionDraft}
                onChange={(event) => onDirectionDraftChange(event.target.value)}
                placeholder="Example: focus on reliability and fixing failing CI before proposing new features."
              />
            </label>
            <label className="quiet-check">
              <input
                type="checkbox"
                checked={directionPause}
                onChange={(event) => onDirectionPauseChange(event.target.checked)}
              />
              <CircleStop size={14} />
              <span>Pause new loops after this one</span>
            </label>
            <div className="compact-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={!directionDraft.trim() || Boolean(pendingAction)}
                onClick={() => onSaveDirection("next_loop")}
              >
                <PlayCircle size={14} />
                Use for next loop
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!directionDraft.trim() || Boolean(pendingAction)}
                onClick={() => onSaveDirection("standing")}
              >
                <RefreshCw size={14} />
                Save standing direction
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state compact">Connect a project to steer an isolated team.</div>
        )}
      </div>
    );
  }

  if (activeInsight === "ideas") {
    const suggested = opportunitiesState.items
      .filter((item) => !/accepted|promoted|dismissed|rejected/i.test(item.status || ""))
      .slice(0, 3);
    const recentlyAccepted = opportunitiesState.items
      .filter((item) => /accepted|promoted/i.test(item.status || ""))
      .slice(0, 3);
    const proposal = proposalState.proposal;
    return (
      <div className="ideas-panel" data-testid="ideas-panel">
        <div className="insight-inline-header">
          <span className="insight-kicker">
            <Bot size={14} /> Autonomous ideation
          </span>
          <button
            className="text-button"
            type="button"
            disabled={!activeProject || opportunitiesState.status === "loading" || Boolean(pendingAction)}
            onClick={onScanOpportunities}
          >
            Scan
          </button>
        </div>
        <section className="compact-section">
          <h3>Suggested next</h3>
          {suggested.length ? (
            <div className="opportunity-list">
              {suggested.map((item) => (
                <article className="opportunity-row" key={item.id}>
                  <span>
                    <strong>{item.title || "Untitled opportunity"}</strong>
                    <small>
                      {compactMeta([
                        item.source,
                        item.risk && `risk ${item.risk}`,
                        item.score !== undefined && `score ${item.score}`
                      ])}
                    </small>
                  </span>
                  <p>{item.summary || "No summary provided yet."}</p>
                  <div className="compact-actions inline">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={Boolean(pendingAction)}
                      onClick={() => onPromoteOpportunity(item.id)}
                    >
                      Promote
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <DetailEmpty state={opportunitiesState} fallback="No suggested opportunities yet." />
          )}
        </section>

        <section className="compact-section">
          <h3>Awaiting decision</h3>
          {proposal ? (
            <article className="proposal-card">
              <div className="proposal-title">
                <span>
                  <strong>{proposal.title || proposal.problem || "Proposal for selected work"}</strong>
                  <small>
                    {compactMeta([
                      proposal.status,
                      proposal.version !== undefined && `v${proposal.version}`,
                      proposal.autoAcceptEligible ? "auto-eligible" : "reviewable"
                    ])}
                  </small>
                </span>
              </div>
              <p>{proposal.recommendedApproach || proposal.researchSummary || "Proposal details are available."}</p>
              <details className="compact-disclosure">
                <summary>Plan details</summary>
                <dl className="proposal-details">
                  {proposal.problem && (
                    <>
                      <dt>Problem</dt>
                      <dd>{proposal.problem}</dd>
                    </>
                  )}
                  {proposal.researchSummary && (
                    <>
                      <dt>Research</dt>
                      <dd>{proposal.researchSummary}</dd>
                    </>
                  )}
                  {proposal.validationPlan && (
                    <>
                      <dt>Validation</dt>
                      <dd>{proposal.validationPlan}</dd>
                    </>
                  )}
                  {proposal.rollbackPlan && (
                    <>
                      <dt>Rollback</dt>
                      <dd>{proposal.rollbackPlan}</dd>
                    </>
                  )}
                </dl>
                <InlineList title="Tasks" items={proposal.tasks} />
                <InlineList title="Risks" items={proposal.risks} />
              </details>
              <details className="compact-disclosure decision-disclosure">
                <summary>Decision</summary>
                <textarea
                  value={proposalFeedback}
                  onChange={(event) => onProposalFeedbackChange(event.target.value)}
                  placeholder="Optional feedback for request changes..."
                />
                <div className="compact-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={Boolean(pendingAction) || !isProposalActionable(proposal)}
                    onClick={() => onProposalDecision("accept")}
                  >
                    Accept
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={Boolean(pendingAction) || !isProposalActionable(proposal)}
                    onClick={() => onProposalDecision("revise")}
                  >
                    Request changes
                  </button>
                  <button
                    className="secondary-button danger"
                    type="button"
                    disabled={Boolean(pendingAction) || !isProposalActionable(proposal)}
                    onClick={() => onProposalDecision("reject")}
                  >
                    Reject
                  </button>
                </div>
              </details>
            </article>
          ) : (
            <DetailEmpty state={proposalState} fallback="No proposal is awaiting a decision." />
          )}
        </section>

        <section className="compact-section">
          <h3>Recently accepted</h3>
          {recentlyAccepted.length ? (
            <div className="accepted-list">
              {recentlyAccepted.map((item) => (
                <div className="accepted-row" key={item.id}>
                  <strong>{item.title || "Accepted opportunity"}</strong>
                  <span>{item.status || "accepted"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">No accepted proposals yet.</div>
          )}
        </section>
      </div>
    );
  }

  if (activeInsight === "teamMessages") {
    return (
      <div className="team-message-list" data-testid="team-messages-panel">
        <div className="insight-inline-header">
          <span className="insight-kicker">
            <Bot size={14} /> Agent communication
          </span>
          <small>{teamMessagesState.items.length ? `${teamMessagesState.items.length} messages` : "Quiet"}</small>
        </div>
        {teamMessagesState.items.length ? (
          teamMessagesState.items.slice(0, 6).map((message, index) => (
            <article className="team-message-row" key={message.id || `${message.createdAt}-${index}`}>
              <div>
                <strong>{message.title || readableToken(message.type || "team message")}</strong>
                <span>
                  {compactMeta([
                    readableToken(message.ownerAgent || message.agent),
                    message.stage,
                    message.workItemId,
                    formatDate(message.createdAt || message.updatedAt)
                  ])}
                </span>
              </div>
              <p>{message.summary || message.message || "No message body provided."}</p>
            </article>
          ))
        ) : (
          <DetailEmpty state={teamMessagesState} fallback="No durable team messages yet." />
        )}
      </div>
    );
  }

  if (activeInsight === "loopHistory") {
    return (
      <div className="loop-history-list" data-testid="loop-history-panel">
        <div className="insight-inline-header">
          <span className="insight-kicker">
            <RefreshCw size={14} /> Loop history
          </span>
          <small>{loopRunsState.items.length ? `${loopRunsState.items.length} runs` : "No runs"}</small>
        </div>
        {loopRunsState.items.length ? (
          loopRunsState.items.slice(0, 5).map((run) => (
            <article className="loop-run-row" key={run.id}>
              <div className="loop-run-title">
                <span>
                  <strong>{run.workItemId || run.id}</strong>
                  <small>{compactMeta([run.status, run.currentStage || run.stage, run.triggerSource])}</small>
                </span>
                {run.blockingReason ? <em>Blocked</em> : null}
              </div>
              <p>
                {run.closureSummary ||
                  run.blockingReason ||
                  run.nextRecommendedLoop ||
                  "Loop is waiting for its first closure summary."}
              </p>
              <div className="micro-meta">
                {run.activeAgents?.length ? <span>{run.activeAgents.length} agents</span> : null}
                {run.startRepoSha && <span>{shortSha(run.startRepoSha)} start</span>}
                {run.endRepoSha && <span>{shortSha(run.endRepoSha)} end</span>}
                {run.releaseState && <span>{run.releaseState}</span>}
                {(run.closedAt || run.updatedAt || run.startedAt) && (
                  <span>{formatDate(run.closedAt || run.updatedAt || run.startedAt)}</span>
                )}
              </div>
            </article>
          ))
        ) : (
          <DetailEmpty state={loopRunsState} fallback="No loop history yet." />
        )}
      </div>
    );
  }

  if (activeInsight === "team") {
    return (
      <div className="team-list" data-testid="team-panel">
        {agentRows.map((agent) => (
          <div className="agent-row" key={agent.name}>
            <span className={`agent-icon ${agent.tone}`}>
              <agent.icon size={16} />
            </span>
            <span className="agent-copy">
              <strong>{agent.name}</strong>
              <small>{agent.task}</small>
            </span>
            <span className={`agent-status ${agent.status.toLowerCase()}`}>{agent.status}</span>
          </div>
        ))}
      </div>
    );
  }

  if (activeInsight === "memory") {
    return (
      <div className="memory-list">
        {visibleMemories.length ? (
          visibleMemories.map((memory) => (
            <article key={memory.id}>
              <strong>{memory.title}</strong>
              <span>
                {memory.kind} · {memory.permanence}
              </span>
              <p>{memory.content}</p>
            </article>
          ))
        ) : (
          <div className="empty-state compact">No stored context yet.</div>
        )}
      </div>
    );
  }

  if (activeInsight === "capabilities") {
    const team = activeProject
      ? status.projectTeams.find((item) => item.projectId === activeProject.projectId)
      : status.projectTeams[0];
    const capabilities = team?.capabilities || activeProject?.capabilities || [];
    return (
      <div className="capability-list" data-testid="capability-panel">
        {team && (
          <div className="team-summary">
            <strong>{team.name}</strong>
            <span>
              {team.agentsOnline}/{team.agentsTotal} agents · {team.queueDepth} queued · {team.activeWorkItems} running
            </span>
          </div>
        )}
        {capabilities.length ? (
          capabilities.map((capability) => (
            <div className="capability-row" key={capability.id}>
              <span className={`capability-dot ${capability.status}`} />
              <span>
                <strong>{capability.label}</strong>
                <small>{capability.summary}</small>
                {capability.details.length > 0 && (
                  <span className="capability-details">
                    {capability.details.map((detail) => (
                      <i key={detail}>{detail}</i>
                    ))}
                  </span>
                )}
              </span>
              <em>{capability.status.replace(/_/g, " ")}</em>
            </div>
          ))
        ) : (
          <div className="empty-state compact">Connect a project to see tool capabilities.</div>
        )}
      </div>
    );
  }

  if (activeInsight === "events") {
    return (
      <div className="event-list">
        {visibleEvents.length ? (
          visibleEvents.map(([time, level, source, message, item]) => (
            <div className="event-row" key={`${time}-${source}-${message}`}>
              <time>{time}</time>
              <span className={`event-level ${String(level).toLowerCase()}`}>{level}</span>
              <strong>{source}</strong>
              <p>{message}</p>
              <em>{item}</em>
            </div>
          ))
        ) : (
          <div className="empty-state compact">No events yet.</div>
        )}
      </div>
    );
  }

  return (
    <div className="release-panel" data-testid="release-panel">
      <div className={`release-state ${releaseReady ? "ready" : "waiting"}`}>
        <ShieldCheck size={19} />
        <span>{status.releaseReadiness.target}</span>
        <strong>{releaseReady ? "Ready" : status.releaseReadiness.status}</strong>
      </div>
      <div className="check-grid">
        {status.releaseReadiness.checks.length ? (
          status.releaseReadiness.checks.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))
        ) : (
          <div className="empty-state compact">No release checks yet.</div>
        )}
      </div>
    </div>
  );
}

function systemPresentation(status: Status, apiState: ApiState) {
  if (!apiState.connected) {
    return {
      label: "Offline",
      className: "warning",
      dot: "amber"
    };
  }
  if (status.system.emergencyStop) {
    return { label: "Stopped", className: "warning", dot: "amber" };
  }
  if (!status.system.operational) {
    return { label: "Degraded", className: "warning", dot: "amber" };
  }
  return { label: "Operational", className: "ok", dot: "green" };
}

function apiNotice(apiState: ApiState) {
  if (apiState.connected) return "";
  return `Controller connection failed: ${apiState.lastError}. Showing offline state.`;
}

function deriveAgentRows(status: Status, connected: boolean): AgentLane[] {
  if (!connected) {
    return roleLanes.map((lane) => ({
      icon: lane.icon,
      name: lane.name,
      role: lane.role,
      tone: lane.tone,
      status: "Offline",
      work: "-",
      task: "Controller offline",
      progress: 0
    }));
  }
  return roleLanes.map((lane) => {
    const latestArtifact = [...status.artifacts].reverse().find((artifact) => artifact.ownerAgent === lane.agentRole);
    const workItem = latestArtifact
      ? status.workItems.find((item) => item.id === latestArtifact.workItemId)
      : undefined;
    const agentStatus = statusForAgent(latestArtifact, workItem?.state);
    return {
      icon: lane.icon,
      name: lane.name,
      role: lane.role,
      tone: lane.tone,
      status: agentStatus,
      work: latestArtifact?.workItemId || "-",
      task: latestArtifact?.summary || "Waiting for routed work",
      progress: latestArtifact ? progressForStage(latestArtifact.stage) : 0
    };
  });
}

function statusForAgent(artifact: StageArtifact | undefined, state?: string): string {
  if (!artifact) return "Idle";
  if (artifact.status === "blocked" || artifact.status === "failed" || state === "BLOCKED") return "Blocked";
  if (state === "CLOSED") return "Complete";
  return "Active";
}

function progressForStage(stage: string): number {
  const order = [
    "NEW",
    "INTAKE",
    "RND",
    "PROPOSAL",
    "AWAITING_ACCEPTANCE",
    "CONTRACT",
    "FRONTEND_BUILD",
    "BACKEND_BUILD",
    "INTEGRATION",
    "VERIFY",
    "RELEASE",
    "CLOSED"
  ];
  const index = order.indexOf(stage);
  return index === -1 ? 0 : Math.round(((index + 1) / order.length) * 100);
}

function DetailEmpty(input: { state: { status: DetailFetchStatus; message: string }; fallback: string }) {
  const copy = input.state.status === "loading" ? "Loading..." : input.state.message || input.fallback;
  return <div className="empty-state compact">{copy}</div>;
}

function InlineList(input: { title: string; items?: string[] }) {
  if (!input.items?.length) return null;
  return (
    <div className="inline-list">
      <strong>{input.title}</strong>
      <ul>
        {input.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const payload = await readResponseJson(response);
  const record = asRecord(payload);
  const message =
    record && typeof record.error === "string"
      ? record.error
      : record && typeof record.detail === "string"
        ? record.detail
        : record && typeof record.message === "string"
          ? record.message
          : "";
  return message || `HTTP ${response.status}`;
}

function extractList<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

function extractObject<T>(payload: unknown, keys: string[]): T | undefined {
  const record = asRecord(payload);
  if (!record) return undefined;
  let sawKnownKey = false;
  for (const key of keys) {
    if (key in record) sawKnownKey = true;
    const nested = asRecord(record[key]);
    if (nested) return nested as T;
  }
  if (sawKnownKey) return undefined;
  return Object.keys(record).length ? (record as T) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function activeProjectIdFromState(projects: ProjectConnection[], selectedProjectId: string): string {
  return (
    projects.find((project) => project.id === selectedProjectId)?.projectId ||
    projects.find((project) => project.active)?.projectId ||
    ""
  );
}

function isProposalActionable(proposal: ProposalArtifact): boolean {
  return !/accepted|auto_accepted|rejected|revision_requested|revising/i.test(proposal.status || "");
}

function compactMeta(values: Array<string | number | false | null | undefined>): string {
  return values
    .filter(
      (value): value is string | number =>
        value !== false && value !== null && value !== undefined && String(value).trim().length > 0
    )
    .map((value) => String(value))
    .join(" · ");
}

function readableToken(value?: string): string {
  if (!value) return "";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function shortSha(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

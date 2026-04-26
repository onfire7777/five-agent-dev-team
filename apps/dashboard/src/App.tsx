import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleStop,
  ExternalLink,
  GitBranch,
  Github,
  LayoutDashboard,
  LogOut,
  PlayCircle,
  RefreshCw,
  Rocket,
  SearchCheck,
  ShieldCheck,
  SquareKanban,
  TerminalSquare,
  Workflow,
  type LucideIcon
} from "lucide-react";
import { createSampleStatus } from "../../../packages/shared/src/sample-data";
import type { AgentRole, MemoryRecord, ProjectConnection, StageArtifact } from "../../../packages/shared/src";

declare const __DASHBOARD_API_BASE__: string | undefined;

type Status = ReturnType<typeof createSampleStatus>;
type RoutingKey = "frontendNeeded" | "backendNeeded" | "rndNeeded";
type InsightView = "release" | "team" | "capabilities" | "memory" | "events";
type RequestType = "feature" | "bug" | "performance" | "security" | "privacy" | "refactor" | "research";
type Priority = "low" | "medium" | "high" | "urgent";
type RiskLevel = "low" | "medium" | "high";

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
  usingFallback: boolean;
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

const API_BASE = typeof __DASHBOARD_API_BASE__ === "string" && __DASHBOARD_API_BASE__ ? __DASHBOARD_API_BASE__ : "http://localhost:4310";

function createOfflineStatus(): Status {
  const status = createSampleStatus();
  return {
    ...status,
    system: {
      ...status.system,
      operational: false,
      emergencyStop: false,
      queueDepth: 0,
      agentsOnline: 0,
      githubSync: "offline",
      systemLoad: 0,
      emergencyReason: ""
    },
    pipeline: Object.fromEntries(Object.keys(status.pipeline).map((key) => [key, 0])) as Status["pipeline"],
    projectTeams: [],
    workItems: [],
    artifacts: [],
    releaseReadiness: {
      ...status.releaseReadiness,
      status: "unknown",
      target: "Controller offline"
    },
    logs: [],
    sharedContext: {
      activeThreads: [],
      research: []
    }
  };
}

const fallbackAgentRows: AgentLane[] = [
  {
    icon: SquareKanban,
    name: "Product",
    role: "Product & Delivery",
    status: "Active",
    work: "WI-1289",
    task: "Locking acceptance criteria",
    progress: 74,
    tone: "blue"
  },
  {
    icon: SearchCheck,
    name: "R&D",
    role: "Architecture",
    status: "Active",
    work: "WI-1290",
    task: "Finalizing contract",
    progress: 66,
    tone: "green"
  },
  {
    icon: LayoutDashboard,
    name: "Frontend",
    role: "UX Engineering",
    status: "Active",
    work: "WI-1290",
    task: "Building interface states",
    progress: 58,
    tone: "violet"
  },
  {
    icon: TerminalSquare,
    name: "Backend",
    role: "Systems Engineering",
    status: "Active",
    work: "WI-1290",
    task: "Implementing API",
    progress: 62,
    tone: "slate"
  },
  {
    icon: ShieldCheck,
    name: "Quality",
    role: "Security & Release",
    status: "Blocked",
    work: "WI-1291",
    task: "Waiting on rollback proof",
    progress: 42,
    tone: "amber"
  }
];

const roleLanes: Array<Omit<AgentLane, "status" | "work" | "task" | "progress"> & { agentRole: AgentRole }> = [
  {
    icon: SquareKanban,
    name: "Product",
    role: "Product & Delivery",
    tone: "blue",
    agentRole: "product-delivery-orchestrator"
  },
  {
    icon: SearchCheck,
    name: "R&D",
    role: "Architecture",
    tone: "green",
    agentRole: "rnd-architecture-innovation"
  },
  {
    icon: LayoutDashboard,
    name: "Frontend",
    role: "UX Engineering",
    tone: "violet",
    agentRole: "frontend-ux-engineering"
  },
  {
    icon: TerminalSquare,
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

const routeToggles: Array<[RoutingKey, string]> = [
  ["rndNeeded", "R&D"],
  ["frontendNeeded", "Frontend"],
  ["backendNeeded", "Backend"]
];

const flowGroups = [
  { label: "Intake", states: ["NEW", "INTAKE"], icon: SquareKanban },
  { label: "Research", states: ["RND", "CONTRACT"], icon: SearchCheck },
  { label: "Build", states: ["FRONTEND_BUILD", "BACKEND_BUILD", "INTEGRATION"], icon: Workflow },
  { label: "Verify", states: ["VERIFY", "BLOCKED"], icon: ShieldCheck },
  { label: "Release", states: ["RELEASE", "CLOSED"], icon: Rocket }
] as const;

const insightOptions: Array<[InsightView, string]> = [
  ["release", "Release gate"],
  ["team", "Team lanes"],
  ["capabilities", "Capabilities"],
  ["memory", "Memory"],
  ["events", "Events"]
];

const requestTypeOptions: RequestType[] = ["feature", "bug", "performance", "security", "privacy", "refactor", "research"];
const priorityOptions: Priority[] = ["low", "medium", "high", "urgent"];
const riskLevelOptions: RiskLevel[] = ["low", "medium", "high"];

const defaultGitHubAccount: GitHubAccount = {
  connected: false,
  source: "none",
  scopes: [],
  utilities: [],
  clientIdConfigured: false,
  message: "GitHub account status has not loaded yet."
};

export function App() {
  const [status, setStatus] = useState<Status>(() => createSampleStatus());
  const [apiState, setApiState] = useState<ApiState>({
    connected: false,
    usingFallback: true,
    lastError: "Connecting to controller"
  });
  const [loading, setLoading] = useState(false);
  const [selectedWorkItem, setSelectedWorkItem] = useState("WI-1290");
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
      setApiState({ connected: true, usingFallback: false, lastError: "" });
      try {
        await loadMemories();
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
      setStatus(createOfflineStatus());
      setMemories([]);
      setProjects([]);
      setGithubAccount(defaultGitHubAccount);
      setApiState({
        connected: false,
        usingFallback: true,
        lastError: error instanceof Error ? error.message : "Controller unavailable"
      });
      return false;
    }
  }

  async function loadMemories(workItemId?: string) {
    const url = new URL(`${API_BASE}/api/memories`);
    if (workItemId) url.searchParams.set("workItemId", workItemId);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setMemories(await response.json());
  }

  async function loadGithubAccount() {
    const response = await fetch(`${API_BASE}/api/github/account`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const account = await response.json() as GitHubAccount;
    setGithubAccount(account);
    return account;
  }

  async function loadProjects() {
    const response = await fetch(`${API_BASE}/api/projects`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const nextProjects = await response.json() as ProjectConnection[];
    setProjects(nextProjects);
    const selectedId = selectedProjectIdRef.current;
    const active = nextProjects.find((project) => project.id === selectedId) ||
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function startGithubConnection() {
    setGithubAccountError("");
    setGithubConnect({ status: "starting", message: "Starting GitHub connection..." });
    try {
      const session = await postControl("/api/github/device/start") as GitHubDeviceSession;
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

  async function createWorkItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");
    const targetProject = projects.find((project) => project.id === selectedProjectIdRef.current) ||
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
      await loadStatus();
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
      const project = await postControl("/api/projects", {
        name: projectDraft.name.trim() || `${projectDraft.repoOwner.trim()}/${projectDraft.repoName.trim()}`,
        repoOwner: projectDraft.repoOwner.trim(),
        repoName: projectDraft.repoName.trim(),
        defaultBranch: projectDraft.defaultBranch.trim() || "main",
        localPath: projectDraft.localPath.trim(),
        webResearchEnabled: projectDraft.webResearchEnabled,
        githubMcpEnabled: projectDraft.githubMcpEnabled,
        githubWriteEnabled: projectDraft.githubWriteEnabled,
        active: true
      }) as ProjectConnection;
      selectProjectId(project.id);
      await loadProjects();
      await loadStatus();
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
      const project = await postControl(`/api/projects/${encodeURIComponent(projectId)}/activate`) as ProjectConnection;
      selectProjectId(project.id);
      hydrateProjectDraft(project, true);
      await loadProjects();
      await loadStatus();
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
      await postControl(path, { reason: "Operator dashboard stop" });
      await loadStatus();
    } catch {
      setApiState({
        connected: false,
        usingFallback: true,
        lastError: "Emergency control request failed"
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    loadGithubAccount().catch(() => setGithubAccount(defaultGitHubAccount));
    const timer = window.setInterval(loadStatus, 10000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (githubConnect.status !== "pending" || !githubConnect.session) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        const result = await postControl("/api/github/device/poll", {
          sessionId: githubConnect.session?.sessionId
        }) as {
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
          await loadStatus();
          return;
        }
        if (result.status === "pending") {
          setGithubConnect((current) => ({
            ...current,
            message: result.message || current.message,
            session: current.session ? {
              ...current.session,
              interval: result.interval || current.session.interval
            } : current.session
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
    }, Math.max(githubConnect.session.interval, 5) * 1000);
    return () => window.clearTimeout(timer);
  }, [githubConnect]);

  useEffect(() => {
    if (!("EventSource" in window)) return undefined;
    const source = new EventSource(`${API_BASE}/api/events/stream`);
    source.addEventListener("agent-event", () => {
      loadStatus();
    });
    return () => source.close();
  }, []);

  const agentRows = useMemo(() => deriveAgentRows(status, apiState.connected), [status, apiState.connected]);
  const releaseReady = apiState.connected && status.releaseReadiness.status === "ready";
  const visibleMemories = memories.slice(0, 3);
  const visibleEvents = status.logs.slice(0, 4);
  const pipeline = status.pipeline as Record<string, number>;
  const activeWorkItems = useMemo(() => status.workItems.filter((item) => item.state !== "CLOSED").slice(0, 5), [status.workItems]);
  const activeProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || projects.find((project) => project.active),
    [projects, selectedProjectId]
  );
  const activeTeam = useMemo(
    () => activeProject ? status.projectTeams.find((team) => team.projectId === activeProject.projectId) : undefined,
    [status.projectTeams, activeProject]
  );
  const selected = useMemo(
    () => activeWorkItems.find((item) => item.id === selectedWorkItem) || activeWorkItems[0],
    [selectedWorkItem, activeWorkItems]
  );
  const systemState = systemPresentation(status, apiState);
  const apiMessage = apiNotice(apiState);
  const connectedGithubUtilities = githubAccount.utilities.filter((utility) =>
    utility.status === "ready" || utility.status === "available"
  );
  const githubUtilityPreview = connectedGithubUtilities.slice(0, 5);

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
          <span>{status.system.agentsOnline}/{status.system.agentsTotal} agents</span>
          <span>{status.system.scheduler.maxConcurrentAgentRuns} parallel</span>
          <span>{apiState.connected ? status.system.githubSync : "offline"}</span>
        </div>

        <div className="header-actions">
          <button className="icon-button" onClick={loadStatus} disabled={loading} data-testid="refresh-state" aria-label="Refresh">
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
            <AlertTriangle size={16} />
            <span>{status.system.emergencyReason || apiMessage}</span>
          </div>
        )}

        <section className="command-panel" aria-labelledby="create-work-title" data-testid="work-intake">
          <h2 className="sr-only" id="create-work-title">Create work</h2>
          <div className="section-label">
            <span>Command</span>
            <strong>{activeProject ? activeProject.repo : "Connect project first"}</strong>
          </div>

          <form className="command-form" onSubmit={createWorkItem}>
            <label className="field command-title">
              <span>Work item</span>
              <input
                value={workDraft.title}
                onChange={(event) => setWorkDraft((draft) => ({ ...draft, title: event.target.value }))}
                placeholder="Describe the work to run..."
                data-testid="work-title"
                aria-invalid={Boolean(createError)}
                aria-describedby={createError ? "work-title-error" : undefined}
              />
            </label>
            <button className="primary-button" type="submit" disabled={loading || !apiState.connected || !activeProject} data-testid="start-loop">
              <PlayCircle size={16} />
              Start
            </button>

            <details className="options-menu">
              <summary>Project</summary>
              <div className="project-grid" data-testid="project-connection">
                <div className="project-current">
                  <span className={`project-status ${activeProject?.status === "connected" ? "ready" : "attention"}`}>
                    <Github size={15} />
                    {activeProject ? activeProject.status.replace(/_/g, " ") : "No repo connected"}
                  </span>
                  <strong>{activeProject?.name || "Connect an isolated GitHub repo"}</strong>
                  <small>{activeProject ? `${activeProject.repo} · ${activeProject.localPath}` : "Each repo gets its own five-agent team, memory namespace, GitHub stack, MCP tools, and work queue scope."}</small>
                  {activeProject && (
                    <div className="project-badges" aria-label="Project capabilities">
                      <span>{activeProject.ghAuthed ? "CLI ready" : "CLI auth needed"}</span>
                      <span>{activeProject.githubMcpAuthenticated ? "MCP ready" : activeProject.githubMcpEnabled ? "MCP auth needed" : "MCP off"}</span>
                      <span>{activeProject.githubSdkConnected ? "SDK ready" : "SDK auth needed"}</span>
                      <span>{activeTeam ? `${activeTeam.agentsOnline}/${activeTeam.agentsTotal} agents` : "5-agent team"}</span>
                      <span>{activeProject.webResearchEnabled ? "Deep research" : "Research off"}</span>
                    </div>
                  )}
                </div>

                <div className={`github-account-card ${githubAccount.connected ? "ready" : "attention"}`} data-testid="github-account-card">
                  <div className="github-account-main">
                    {githubAccount.avatarUrl ? (
                      <img className="github-account-avatar" src={githubAccount.avatarUrl} alt="" />
                    ) : (
                      <span className="github-account-avatar fallback">
                        <Github size={16} />
                      </span>
                    )}
                    <span>
                      <strong>{githubAccount.connected ? `GitHub: ${githubAccount.login}` : "Connect GitHub account"}</strong>
                      <small>
                        {githubAccount.connected
                          ? `${githubAccount.source === "local" ? "Dashboard OAuth" : githubAccount.sourceName || "Environment"} powers ${connectedGithubUtilities.length || "GitHub"} utilities.`
                          : githubAccount.message}
                      </small>
                      {githubUtilityPreview.length > 0 && (
                        <span className="github-utility-preview" aria-label="Connected GitHub utilities">
                          {githubUtilityPreview.map((utility) => <i key={utility.id}>{utility.label}</i>)}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="github-account-actions">
                    {githubConnect.status === "pending" && githubConnect.session ? (
                      <>
                        <span className="github-connect-code" aria-label="GitHub verification code">{githubConnect.session.userCode}</span>
                        <a
                          className="secondary-link"
                          href={githubConnect.session.verificationUriComplete || githubConnect.session.verificationUri}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink size={14} />
                          Open GitHub
                        </a>
                      </>
                    ) : githubAccount.connected ? (
                      githubAccount.source === "local" ? (
                        <button className="secondary-button" type="button" onClick={disconnectGithubAccount} disabled={loading}>
                          <LogOut size={15} />
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
                        disabled={loading || githubConnect.status === "starting" || !apiState.connected || !githubAccount.clientIdConfigured}
                      >
                        <Github size={15} />
                        {githubAccount.clientIdConfigured ? "Connect GitHub" : "OAuth setup needed"}
                      </button>
                    )}
                  </div>
                  {(githubConnect.message || githubAccountError) && (
                    <small className={githubConnect.status === "failed" || githubAccountError ? "github-account-message error" : "github-account-message"}>
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
                      onChange={(event) => setProjectDraft((draft) => ({ ...draft, githubMcpEnabled: event.target.checked }))}
                    />
                    <span>GitHub MCP</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={projectDraft.githubWriteEnabled}
                      onChange={(event) => setProjectDraft((draft) => ({ ...draft, githubWriteEnabled: event.target.checked }))}
                    />
                    <span>MCP writes</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={projectDraft.webResearchEnabled}
                      onChange={(event) => setProjectDraft((draft) => ({ ...draft, webResearchEnabled: event.target.checked }))}
                    />
                    <span>Deep research</span>
                  </label>
                  <button className="secondary-button" type="button" onClick={connectProject} disabled={loading || !apiState.connected}>
                    <GitBranch size={15} />
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
                        <small>{project.repo} · {project.active ? "team enabled" : "inactive"}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </form>
          {createError && <p className="form-error" id="work-title-error" role="alert">{createError}</p>}
          {projectError && <p className="form-error" role="alert">{projectError}</p>}
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
                <select value={activeInsight} onChange={(event) => setActiveInsight(event.target.value as InsightView)} data-testid="insight-select">
                  {insightOptions.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {renderInsight(activeInsight, { agentRows, releaseReady, status, visibleMemories, visibleEvents, activeProject })}
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
  }
) {
  const { agentRows, releaseReady, status, visibleMemories, visibleEvents, activeProject } = input;

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
    const fallbackThreads = status.sharedContext.activeThreads.slice(0, 3);
    return (
      <div className="memory-list">
        {visibleMemories.length ? (
          visibleMemories.map((memory) => (
            <article key={memory.id}>
              <strong>{memory.title}</strong>
              <span>{memory.kind} · {memory.permanence}</span>
              <p>{memory.content}</p>
            </article>
          ))
        ) : fallbackThreads.length ? (
          fallbackThreads.map(([agent, item, summary]) => (
            <article key={`${agent}-${item}`}>
              <strong>{agent}</strong>
              <span>{item}</span>
              <p>{summary}</p>
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
            <span>{team.agentsOnline}/{team.agentsTotal} agents · {team.queueDepth} queued · {team.activeWorkItems} running</span>
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
                    {capability.details.map((detail) => <i key={detail}>{detail}</i>)}
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
        {releaseReady ? <CheckCircle2 size={19} /> : <ShieldCheck size={19} />}
        <span>{status.releaseReadiness.target}</span>
        <strong>{releaseReady ? "Ready" : status.releaseReadiness.status}</strong>
      </div>
      <div className="check-grid">
        {status.releaseReadiness.checks.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function systemPresentation(status: Status, apiState: ApiState) {
  if (!apiState.connected) {
    return {
      label: apiState.usingFallback ? "Demo Data" : "Offline",
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
  return apiState.usingFallback
    ? `Controller connection failed: ${apiState.lastError}. Showing offline state.`
    : apiState.lastError;
}

function deriveAgentRows(status: Status, connected: boolean): AgentLane[] {
  if (!connected) return fallbackAgentRows;
  return roleLanes.map((lane) => {
    const latestArtifact = [...status.artifacts].reverse().find((artifact) => artifact.ownerAgent === lane.agentRole);
    const workItem = latestArtifact ? status.workItems.find((item) => item.id === latestArtifact.workItemId) : undefined;
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
  const order = ["NEW", "INTAKE", "RND", "CONTRACT", "FRONTEND_BUILD", "BACKEND_BUILD", "INTEGRATION", "VERIFY", "RELEASE", "CLOSED"];
  const index = order.indexOf(stage);
  return index === -1 ? 0 : Math.round(((index + 1) / order.length) * 100);
}

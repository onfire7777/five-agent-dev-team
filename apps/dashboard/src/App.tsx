import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleStop,
  GitBranch,
  Github,
  LayoutDashboard,
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
type InsightView = "release" | "team" | "memory" | "events";
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
};

type ApiState = {
  connected: boolean;
  usingFallback: boolean;
  lastError: string;
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
  ["memory", "Memory"],
  ["events", "Events"]
];

const requestTypeOptions: RequestType[] = ["feature", "bug", "performance", "security", "privacy", "refactor", "research"];
const priorityOptions: Priority[] = ["low", "medium", "high", "urgent"];
const riskLevelOptions: RiskLevel[] = ["low", "medium", "high"];

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
  const [createError, setCreateError] = useState("");
  const [projectError, setProjectError] = useState("");
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
    githubMcpEnabled: true
  });

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
      return true;
    } catch (error) {
      setStatus(createOfflineStatus());
      setMemories([]);
      setProjects([]);
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

  async function loadProjects() {
    const response = await fetch(`${API_BASE}/api/projects`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const nextProjects = await response.json() as ProjectConnection[];
    setProjects(nextProjects);
    const active = nextProjects.find((project) => project.active) || nextProjects[0];
    if (active) {
      setProjectDraft((draft) => ({
        ...draft,
        repoOwner: draft.repoOwner || active.repoOwner,
        repoName: draft.repoName || active.repoName,
        defaultBranch: draft.defaultBranch || active.defaultBranch,
        localPath: draft.localPath || active.localPath,
        webResearchEnabled: active.webResearchEnabled,
        githubMcpEnabled: active.githubMcpEnabled
      }));
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

  async function createWorkItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");
    const activeProject = projects.find((project) => project.active);
    if (!activeProject) {
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
        projectId: activeProject.projectId,
        repo: activeProject.repo,
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
        active: true
      }) as ProjectConnection;
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
    const timer = window.setInterval(loadStatus, 10000);
    return () => window.clearInterval(timer);
  }, []);

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
  const activeProject = useMemo(() => projects.find((project) => project.active), [projects]);
  const selected = useMemo(
    () => activeWorkItems.find((item) => item.id === selectedWorkItem) || activeWorkItems[0],
    [selectedWorkItem, activeWorkItems]
  );
  const systemState = systemPresentation(status, apiState);
  const apiMessage = apiNotice(apiState);

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
                  <small>{activeProject ? `${activeProject.repo} · ${activeProject.localPath}` : "Each repo gets separate memory, context, MCP tools, and work queue scope."}</small>
                  {activeProject && (
                    <div className="project-badges" aria-label="Project capabilities">
                      <span>{activeProject.ghAuthed ? "gh ready" : "gh auth needed"}</span>
                      <span>{activeProject.githubMcpEnabled ? "GitHub MCP" : "MCP off"}</span>
                      <span>{activeProject.webResearchEnabled ? "Deep research" : "Research off"}</span>
                    </div>
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
                        className={project.active ? "is-active" : ""}
                        onClick={() => activateProject(project.id)}
                        disabled={loading || project.active}
                      >
                        <span>{project.name}</span>
                        <small>{project.repo}</small>
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
            {renderInsight(activeInsight, { agentRows, releaseReady, status, visibleMemories, visibleEvents })}
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
  }
) {
  const { agentRows, releaseReady, status, visibleMemories, visibleEvents } = input;

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

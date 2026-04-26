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
  Lock,
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
import type { AgentRole, MemoryRecord, StageArtifact } from "../../../packages/shared/src";

declare const __DASHBOARD_API_BASE__: string | undefined;

type Status = ReturnType<typeof createSampleStatus>;
type RoutingKey = "frontendNeeded" | "backendNeeded" | "rndNeeded";

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

export function App() {
  const [status, setStatus] = useState<Status>(() => createSampleStatus());
  const [apiState, setApiState] = useState<ApiState>({
    connected: false,
    usingFallback: true,
    lastError: "Connecting to controller"
  });
  const [loading, setLoading] = useState(false);
  const [selectedWorkItem, setSelectedWorkItem] = useState("WI-1290");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [createError, setCreateError] = useState("");
  const [workDraft, setWorkDraft] = useState({
    title: "",
    acceptanceCriteria: "",
    requestType: "feature",
    priority: "medium",
    riskLevel: "medium",
    frontendNeeded: true,
    backendNeeded: true,
    rndNeeded: true
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
      return true;
    } catch (error) {
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

  const selected = useMemo(
    () => status.workItems.find((item) => item.id === selectedWorkItem) || status.workItems[0],
    [selectedWorkItem, status.workItems]
  );
  const agentRows = useMemo(() => deriveAgentRows(status, apiState.connected), [status, apiState.connected]);
  const releaseReady = apiState.connected && status.releaseReadiness.status === "ready";
  const visibleMemories = memories.slice(0, 3);
  const visibleEvents = status.logs.slice(0, 4);
  const pipeline = status.pipeline as Record<string, number>;
  const activeWorkItems = status.workItems.filter((item) => item.state !== "CLOSED").slice(0, 5);
  const systemState = systemPresentation(status, apiState);
  const apiMessage = apiNotice(apiState);

  return (
    <div className="app-shell">
      <header className="top-header">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Bot size={20} />
          </div>
          <div>
            <span>AI Dev Team</span>
            <strong>Autonomous Control</strong>
          </div>
        </div>
        <div className="header-actions">
          <span className={`status-pill ${systemState.className}`}>
            <span className={`dot ${systemState.dot}`} />
            {systemState.label}
          </span>
          <button className="ghost-button" onClick={loadStatus} disabled={loading} data-testid="refresh-state">
            <RefreshCw size={16} />
            Refresh
          </button>
          <button
            className={`stop-button ${status.system.emergencyStop ? "is-resume" : ""}`}
            onClick={toggleEmergencyStop}
            disabled={loading || !apiState.connected}
            data-testid="emergency-toggle"
          >
            {status.system.emergencyStop ? <PlayCircle size={16} /> : <CircleStop size={16} />}
            {status.system.emergencyStop ? "Resume" : "Stop"}
          </button>
        </div>
      </header>

      <main className="page">
        <section className="runtime-strip" aria-label="Runtime state">
          <RuntimeStat label="Queue" value={String(status.system.queueDepth)} icon={Activity} />
          <RuntimeStat label="Agents" value={`${status.system.agentsOnline}/${status.system.agentsTotal}`} icon={Bot} />
          <RuntimeStat label="Parallel" value={`${status.system.scheduler.maxConcurrentAgentRuns} lanes`} icon={Workflow} />
          <RuntimeStat label="GitHub" value={apiState.connected ? status.system.githubSync : "offline"} icon={Github} />
          <RuntimeStat label="Repo writes" value={String(status.system.scheduler.maxConcurrentRepoWrites)} icon={Lock} />
        </section>

        {(apiMessage || status.system.emergencyReason) && (
          <div className="notice" role="status">
            <AlertTriangle size={16} />
            <span>{status.system.emergencyReason || apiMessage}</span>
          </div>
        )}

        <div className="dashboard-grid">
          <div className="main-stack">
            <section className="panel intake-panel" aria-labelledby="create-work-title" data-testid="work-intake">
              <PanelHeader title="Create Work" kicker="Add, route, run" icon={PlayCircle} />
              <form className="intake-form" onSubmit={createWorkItem}>
                <label className="field title-field">
                  <span>Title</span>
                  <input
                    value={workDraft.title}
                    onChange={(event) => setWorkDraft((draft) => ({ ...draft, title: event.target.value }))}
                    placeholder="Feature, bug, refactor, research..."
                    data-testid="work-title"
                  />
                </label>
                <label className="field criteria-field">
                  <span>Acceptance</span>
                  <textarea
                    value={workDraft.acceptanceCriteria}
                    onChange={(event) => setWorkDraft((draft) => ({ ...draft, acceptanceCriteria: event.target.value }))}
                    placeholder="One criterion per line"
                    data-testid="work-criteria"
                  />
                </label>

                <div className="control-row">
                  <label className="field select-field">
                    <span>Type</span>
                    <select
                      value={workDraft.requestType}
                      onChange={(event) => setWorkDraft((draft) => ({ ...draft, requestType: event.target.value }))}
                    >
                      {["feature", "bug", "performance", "security", "privacy", "refactor", "research"].map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field select-field">
                    <span>Priority</span>
                    <select
                      value={workDraft.priority}
                      onChange={(event) => setWorkDraft((draft) => ({ ...draft, priority: event.target.value }))}
                    >
                      {["low", "medium", "high", "urgent"].map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field select-field">
                    <span>Risk</span>
                    <select
                      value={workDraft.riskLevel}
                      onChange={(event) => setWorkDraft((draft) => ({ ...draft, riskLevel: event.target.value }))}
                    >
                      {["low", "medium", "high"].map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <div className="route-toggles" aria-label="Routing">
                    {routeToggles.map(([key, label]) => (
                      <label className="route-toggle" key={key}>
                        <input
                          type="checkbox"
                          checked={workDraft[key]}
                          onChange={(event) => setWorkDraft((draft) => ({ ...draft, [key]: event.target.checked }))}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <button className="primary-button" type="submit" disabled={loading || !apiState.connected} data-testid="start-loop">
                    <PlayCircle size={16} />
                    Start
                  </button>
                </div>
              </form>
              {createError && <p className="form-error">{createError}</p>}
            </section>

            <section className="panel loop-panel" aria-labelledby="workflow-title" data-testid="active-loop">
              <PanelHeader title="Workflow" kicker="Lean Automaker loop" icon={Workflow} />
              <div className="flow-grid">
                {flowGroups.map(({ label, states, icon: Icon }) => {
                  const count = states.reduce((total, state) => total + (pipeline[state] ?? 0), 0);
                  return (
                    <div className="flow-step" key={label}>
                      <span className="step-icon">
                        <Icon size={17} />
                      </span>
                      <span>{label}</span>
                      <strong>{count}</strong>
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
                    >
                      <span className="work-topline">
                        <strong>{item.title}</strong>
                        <em>{item.state}</em>
                      </span>
                      <span className="work-meta">
                        <span>{item.id}</span>
                        <span>{item.priority}</span>
                        <span>{item.riskLevel} risk</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="empty-state">No active work items.</div>
                )}
              </div>
            </section>

            {selected && (
              <section className="panel selected-panel" aria-labelledby="selected-work-title">
                <PanelHeader title="Selected Work" kicker={selected.id} icon={GitBranch} />
                <div className="selected-body">
                  <div>
                    <span className="state-chip">{selected.state}</span>
                    <h2>{selected.title}</h2>
                  </div>
                  <ul className="criteria-list">
                    {selected.acceptanceCriteria.length ? (
                      selected.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)
                    ) : (
                      <li>Acceptance criteria pending.</li>
                    )}
                  </ul>
                </div>
              </section>
            )}
          </div>

          <aside className="side-column">
            <section className="panel team-panel" aria-labelledby="team-title" data-testid="team-panel">
              <PanelHeader title="Team" kicker="Live lanes" icon={Bot} />
              <div className="team-list">
                {agentRows.map((agent) => (
                  <div className="agent-row" key={agent.name}>
                    <span className={`agent-icon ${agent.tone}`}>
                      <agent.icon size={17} />
                    </span>
                    <span className="agent-copy">
                      <strong>{agent.name}</strong>
                      <small>{agent.task}</small>
                    </span>
                    <span className={`agent-status ${agent.status.toLowerCase()}`}>{agent.status}</span>
                    <span className="progress-track" aria-label={`${agent.name} ${agent.progress}%`}>
                      <i style={{ width: `${agent.progress}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel release-panel" aria-labelledby="release-gate-title" data-testid="release-panel">
              <PanelHeader title="Release Gate" kicker={status.releaseReadiness.target} icon={releaseReady ? CheckCircle2 : ShieldCheck} />
              <div className={`release-state ${releaseReady ? "ready" : "waiting"}`}>
                {releaseReady ? <CheckCircle2 size={20} /> : <ShieldCheck size={20} />}
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
            </section>

            <section className="panel memory-panel" aria-labelledby="memory-title">
              <PanelHeader title="Memory" kicker="Persistent context" icon={Activity} />
              <div className="memory-list">
                {visibleMemories.length ? (
                  visibleMemories.map((memory) => (
                    <article key={memory.id}>
                      <strong>{memory.title}</strong>
                      <span>{memory.kind} · {memory.permanence}</span>
                      <p>{memory.content}</p>
                    </article>
                  ))
                ) : (
                  status.sharedContext.activeThreads.length ? (
                    status.sharedContext.activeThreads.slice(0, 3).map(([agent, item, summary]) => (
                      <article key={`${agent}-${item}`}>
                        <strong>{agent}</strong>
                        <span>{item}</span>
                        <p>{summary}</p>
                      </article>
                    ))
                  ) : (
                    <div className="empty-state compact">No stored context yet.</div>
                  )
                )}
              </div>
            </section>

            <section className="panel event-panel" aria-labelledby="events-title">
              <PanelHeader title="Events" kicker="Latest proof" icon={Activity} />
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
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function PanelHeader({ title, kicker, icon: Icon }: { title: string; kicker: string; icon: LucideIcon }) {
  return (
    <div className="panel-header">
      <div>
        <span>{kicker}</span>
        <h2 id={`${title.toLowerCase().replace(/\s+/g, "-")}-title`}>{title}</h2>
      </div>
      <Icon size={18} />
    </div>
  );
}

function RuntimeStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="runtime-stat">
      <Icon size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
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
    ? `Controller connection failed: ${apiState.lastError}. Showing demo or last-known state.`
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

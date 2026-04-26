import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  CircleStop,
  Cloud,
  GitBranch,
  Github,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Lock,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Rocket,
  SearchCheck,
  Settings,
  ShieldCheck,
  SquareKanban,
  TerminalSquare,
  Workflow,
  type LucideIcon
} from "lucide-react";
import { createSampleStatus } from "../../../packages/shared/src/sample-data";
import type { AgentRole, MemoryRecord, StageArtifact } from "../../../packages/shared/src";

type Status = ReturnType<typeof createSampleStatus>;
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

const API_BASE = "http://localhost:4310";

const fallbackAgentRows: AgentLane[] = [
  {
    icon: SquareKanban,
    name: "Product",
    role: "Product & Delivery Orchestrator",
    status: "Active",
    work: "WI-1289",
    task: "Locking acceptance criteria",
    progress: 74,
    tone: "blue"
  },
  {
    icon: SearchCheck,
    name: "R&D",
    role: "Architecture & Innovation",
    status: "Active",
    work: "WI-1290",
    task: "Finalizing API/data contract",
    progress: 66,
    tone: "teal"
  },
  {
    icon: LayoutDashboard,
    name: "Frontend",
    role: "UX & Client Engineering",
    status: "Active",
    work: "WI-1290",
    task: "Building settings states",
    progress: 58,
    tone: "indigo"
  },
  {
    icon: TerminalSquare,
    name: "Backend",
    role: "Systems Engineering",
    status: "Active",
    work: "WI-1290",
    task: "Implementing preference API",
    progress: 62,
    tone: "slate"
  },
  {
    icon: ShieldCheck,
    name: "Quality",
    role: "Security, Privacy & Release",
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
    role: "Product & Delivery Orchestrator",
    tone: "blue",
    agentRole: "product-delivery-orchestrator"
  },
  {
    icon: SearchCheck,
    name: "R&D",
    role: "Architecture & Innovation",
    tone: "teal",
    agentRole: "rnd-architecture-innovation"
  },
  {
    icon: LayoutDashboard,
    name: "Frontend",
    role: "UX & Client Engineering",
    tone: "indigo",
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
    role: "Security, Privacy & Release",
    tone: "amber",
    agentRole: "quality-security-privacy-release"
  }
];

const pipelineOrder = [
  ["NEW", "New"],
  ["INTAKE", "Intake"],
  ["RND", "R&D"],
  ["CONTRACT", "Contract"],
  ["FRONTEND_BUILD", "Frontend"],
  ["BACKEND_BUILD", "Backend"],
  ["INTEGRATION", "Integration"],
  ["VERIFY", "Verify"],
  ["RELEASE", "Release"],
  ["CLOSED", "Closed"],
  ["BLOCKED", "Blocked"]
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
      if (response.blocked) setCreateError(response.reason || "Work item queued while emergency stop is active.");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Work item creation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshFromButton() {
    await loadStatus();
  }

  function systemPresentation() {
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

  const systemState = systemPresentation();
  const agentRows = useMemo(() => deriveAgentRows(status, apiState.connected), [status, apiState.connected]);
  const releaseReady = apiState.connected && status.releaseReadiness.status === "ready";
  const visibleMemories = memories.slice(0, 6);
  const latestSyncCheck = status.releaseReadiness.checks.find(([label]) => label === "Local/Remote Sync")?.[1] || "Pending release gate";

  function apiNotice() {
    if (apiState.connected) return "";
    return apiState.usingFallback
      ? `Controller connection failed: ${apiState.lastError}. Showing demo or last-known state.`
      : apiState.lastError;
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

  return (
    <div className="shell">
      <aside className="rail" aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark"><Bot size={20} /></div>
          <div>
            <strong>AI Dev Team</strong>
            <span>Controller</span>
          </div>
        </div>

        <nav className="nav">
          {[
            { icon: LayoutDashboard, label: "Overview" },
            { icon: ListChecks, label: "Work Items" },
            { icon: Bot, label: "Agents" },
            { icon: Workflow, label: "Pipelines" },
            { icon: Rocket, label: "Releases" },
            { icon: Github, label: "GitHub Sync" },
            { icon: ShieldCheck, label: "Verification" },
            { icon: Activity, label: "Observability" },
            { icon: Settings, label: "Settings" }
          ].map(({ icon: Icon, label }) => (
            <button className={label === "Overview" ? "active" : ""} key={String(label)}>
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <button
          className={`stop-panel ${status.system.emergencyStop ? "is-active" : ""}`}
          onClick={toggleEmergencyStop}
          disabled={loading}
        >
          {status.system.emergencyStop ? <PlayCircle size={22} /> : <CircleStop size={22} />}
          <strong>{status.system.emergencyStop ? "Resume Agents" : "Emergency Stop"}</strong>
          <span>{status.system.emergencyStop ? "Restore workflow execution" : "Immediately halt all workflows"}</span>
        </button>

        <div className="environment">
          <span>Environment</span>
          <strong><span className={`dot ${apiState.connected ? "green" : "amber"}`} /> {apiState.connected ? "Local Runtime" : "Disconnected"}</strong>
          <small>{apiState.usingFallback ? "Demo or last-known state" : "Controller v0.1.0"}</small>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>Autonomous Delivery Console</h1>
            <p>Five-agent software development team with release governance.</p>
          </div>
          <div className="top-metrics">
            <Metric icon={Gauge} label="Load" value={`${status.system.systemLoad}%`} />
            <Metric icon={Cloud} label="Queue" value={String(status.system.queueDepth)} />
            <Metric icon={Bot} label="Agents" value={`${status.system.agentsOnline}/${status.system.agentsTotal}`} />
            <Metric icon={PauseCircle} label="Mode" value={status.system.executionMode} />
            <Metric icon={GitBranch} label="GitHub" value={apiState.connected ? status.system.githubSync : "unknown"} ok={apiState.connected} />
          </div>
        </header>

        <section className="hero-band">
          <div>
            <span className={`status-chip ${systemState.className}`}><span className={`dot ${systemState.dot}`} /> {systemState.label}</span>
            <h2>Fully autonomous team, parallel where it is safe.</h2>
            <p>Designed for ChatGPT Pro plus Codex-style usage: event-triggered stages, controlled parallelism, cooldowns, and release autonomy when local checks, GitHub Actions, security, privacy, rollback, and sync gates are provably clean.</p>
            {status.system.emergencyReason && <p className="api-notice">{status.system.emergencyReason}</p>}
            {apiNotice() && <p className="api-notice">{apiNotice()}</p>}
          </div>
          <button className="primary-action" onClick={refreshFromButton}>
            <RefreshCw size={16} />
            Refresh State
          </button>
        </section>

        <section className="intake-band" aria-labelledby="intake-title">
          <div className="section-head">
            <h3 id="intake-title">New Work Item</h3>
            <span className="subtle-label">Continuous queue intake</span>
          </div>
          <form className="intake-form" onSubmit={createWorkItem}>
            <label className="field wide">
              <span>Title</span>
              <input
                value={workDraft.title}
                onChange={(event) => setWorkDraft((draft) => ({ ...draft, title: event.target.value }))}
                placeholder="Add billing retry safeguards"
              />
            </label>
            <label className="field wide">
              <span>Acceptance Criteria</span>
              <textarea
                value={workDraft.acceptanceCriteria}
                onChange={(event) => setWorkDraft((draft) => ({ ...draft, acceptanceCriteria: event.target.value }))}
                placeholder="One criterion per line"
              />
            </label>
            <div className="intake-controls">
              <label className="field">
                <span>Type</span>
                <select value={workDraft.requestType} onChange={(event) => setWorkDraft((draft) => ({ ...draft, requestType: event.target.value }))}>
                  {["feature", "bug", "performance", "security", "privacy", "refactor", "research"].map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Priority</span>
                <select value={workDraft.priority} onChange={(event) => setWorkDraft((draft) => ({ ...draft, priority: event.target.value }))}>
                  {["low", "medium", "high", "urgent"].map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Risk</span>
                <select value={workDraft.riskLevel} onChange={(event) => setWorkDraft((draft) => ({ ...draft, riskLevel: event.target.value }))}>
                  {["low", "medium", "high"].map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              <div className="toggle-group" aria-label="Routing">
                {[
                  ["frontendNeeded", "Frontend"],
                  ["backendNeeded", "Backend"],
                  ["rndNeeded", "R&D"]
                ].map(([key, label]) => (
                  <label className="toggle" key={key}>
                    <input
                      type="checkbox"
                      checked={Boolean(workDraft[key as "frontendNeeded" | "backendNeeded" | "rndNeeded"])}
                      onChange={(event) => setWorkDraft((draft) => ({ ...draft, [key]: event.target.checked }))}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <button className="primary-action" type="submit" disabled={loading || !apiState.connected}>
                <PlayCircle size={16} />
                Start Loop
              </button>
            </div>
          </form>
          {createError && <p className="api-notice">{createError}</p>}
        </section>

        <section className="pipeline" aria-labelledby="pipeline-title">
          <div className="section-head">
            <h3 id="pipeline-title">Work Item Pipeline</h3>
            <button>View all <ChevronRight size={16} /></button>
          </div>
          <div className="pipeline-grid">
            {pipelineOrder.map(([key, label]) => (
              <button className="stage" key={key}>
                <span>{label}</span>
                <strong>{status.pipeline[key] ?? 0}</strong>
                <small>{describeStage(key)}</small>
              </button>
            ))}
          </div>
        </section>

        <div className="content-grid">
          <section className="agent-table" aria-labelledby="agents-title">
            <div className="section-head">
              <h3 id="agents-title">Agent Lanes</h3>
              <button>Manage agents <ChevronRight size={16} /></button>
            </div>
            <div className="table">
              <div className="row header">
                <span>Agent</span>
                <span>Current Work</span>
                <span>Status</span>
                <span>Progress</span>
              </div>
              {agentRows.map((agent) => (
                <div className="row" key={agent.name}>
                  <span className="agent-name">
                    <span className={`agent-icon ${agent.tone}`}><agent.icon size={18} /></span>
                    <span><strong>{agent.name}</strong><small>{agent.role}</small></span>
                  </span>
                  <span>
                    <strong>{agent.work}</strong>
                    <small>{agent.task}</small>
                  </span>
                  <span className={agent.status === "Blocked" ? "status warn" : agent.status === "Idle" ? "status muted" : "status ok"}>
                    <span className={`dot ${agent.status === "Blocked" ? "amber" : agent.status === "Idle" ? "slate" : "green"}`} />
                    {agent.status}
                  </span>
                  <span className="progress-cell">
                    <span>{agent.progress}%</span>
                    <span className="bar"><i style={{ width: `${agent.progress}%` }} /></span>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <aside className="side-stack">
            <section className="sync-card">
              <div className="section-head compact">
                <h3>Team Context</h3>
                <Workflow size={18} />
              </div>
              <div className="context-list">
                {status.sharedContext.activeThreads.map(([agent, item, summary]) => (
                  <div key={`${agent}-${item}`}>
                    <strong>{agent}</strong>
                    <span>{item}</span>
                    <p>{summary}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="sync-card">
              <div className="section-head compact">
                <h3>Permanent Memory</h3>
                <Activity size={18} />
              </div>
              <div className="memory-list">
                {visibleMemories.length ? visibleMemories.map((memory) => (
                  <div key={memory.id}>
                    <strong>{memory.title}</strong>
                    <span>{memory.kind} · {memory.permanence}</span>
                    <p>{memory.content}</p>
                  </div>
                )) : <p className="empty-note">No persisted memories yet.</p>}
              </div>
            </section>

            <section className="readiness">
              <div className="release-icon"><Check size={22} /></div>
              <h3>{releaseReady ? "Ready for Release" : "Release Gate"}</h3>
              <p>{releaseReady ? "All configured autonomous gates are currently passing." : `${status.releaseReadiness.target} is ${status.releaseReadiness.status}.`}</p>
              <div className="check-list">
                {status.releaseReadiness.checks.map(([label, value]) => (
                  <div key={label}>
                    <span><Check size={14} /> {label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="sync-card">
              <div className="section-head compact">
                <h3>GitHub Sync</h3>
                <Github size={18} />
              </div>
              <dl>
                <div><dt>Repository</dt><dd>configured target</dd></div>
                <div><dt>Default Branch</dt><dd>from policy file</dd></div>
                <div><dt>Sync Status</dt><dd>{status.system.githubSync}</dd></div>
                <div><dt>Latest Proof</dt><dd>{latestSyncCheck}</dd></div>
              </dl>
            </section>

            <section className="sync-card">
              <div className="section-head compact">
                <h3>Smart Scheduler</h3>
                <Lock size={18} />
              </div>
              <dl>
                <div><dt>Mode</dt><dd>{status.system.executionMode}</dd></div>
                <div><dt>Continuous</dt><dd>{status.system.scheduler.continuous ? "Enabled" : "Paused"}</dd></div>
                <div><dt>Poll</dt><dd>{status.system.scheduler.pollIntervalSeconds}s</dd></div>
                <div><dt>Workflow Limit</dt><dd>{status.system.scheduler.maxConcurrentWorkflows}</dd></div>
                <div><dt>Agent Limit</dt><dd>{status.system.scheduler.maxConcurrentAgentRuns}</dd></div>
                <div><dt>Repo Writes</dt><dd>{status.system.scheduler.maxConcurrentRepoWrites}</dd></div>
              </dl>
            </section>
          </aside>
        </div>

        <div className="lower-grid">
          <section className="work-detail">
            <div className="section-head">
              <h3>Selected Work Item</h3>
              <select value={selected?.id || ""} onChange={(event) => setSelectedWorkItem(event.target.value)} disabled={!status.workItems.length}>
                {!status.workItems.length && <option>No work items</option>}
                {status.workItems.map((item) => <option key={item.id}>{item.id}</option>)}
              </select>
            </div>
            {selected && (
              <div className="detail-body">
                <span className="status-chip muted">{selected.state}</span>
                <h4>{selected.title}</h4>
                <p>{selected.acceptanceCriteria.join(" · ") || "Acceptance criteria pending."}</p>
                <div className="detail-tags">
                  <span>{selected.priority} priority</span>
                  <span>{selected.riskLevel} risk</span>
                  <span>{selected.frontendNeeded ? "frontend" : "no frontend"}</span>
                  <span>{selected.backendNeeded ? "backend" : "no backend"}</span>
                </div>
              </div>
            )}
          </section>

          <section className="logs">
            <div className="section-head">
              <h3>Recent Verification Logs</h3>
              <button>Full logs <ChevronRight size={16} /></button>
            </div>
            <div className="log-list">
              {status.logs.map(([time, level, source, message, item]) => (
                <div className="log-row" key={`${time}-${message}`}>
                  <time>{time}</time>
                  <span className={`level ${String(level).toLowerCase()}`}>{level}</span>
                  <strong>{source}</strong>
                  <span>{message}</span>
                  <em>{item}</em>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function Metric({ icon: Icon, label, value, ok }: { icon: LucideIcon; label: string; value: string; ok?: boolean }) {
  return (
    <div className="metric">
      <Icon size={16} />
      <span>{label}</span>
      <strong className={ok ? "green-text" : ""}>{value}</strong>
    </div>
  );
}

function deriveAgentRows(status: Status, connected: boolean): AgentLane[] {
  if (!connected) return fallbackAgentRows;
  return roleLanes.map((lane) => {
    const latestArtifact = status.artifacts.find((artifact) => artifact.ownerAgent === lane.agentRole);
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
  const index = pipelineOrder.findIndex(([key]) => key === stage);
  return index === -1 ? 0 : Math.round(((index + 1) / pipelineOrder.length) * 100);
}

function describeStage(stage: string) {
  const descriptions: Record<string, string> = {
    NEW: "queued request",
    INTAKE: "scope and route",
    RND: "research and contract",
    CONTRACT: "interface lock",
    FRONTEND_BUILD: "client work",
    BACKEND_BUILD: "system work",
    INTEGRATION: "branch merge",
    VERIFY: "quality gates",
    RELEASE: "merge and publish",
    CLOSED: "loop complete",
    BLOCKED: "needs fix"
  };
  return descriptions[stage] || "workflow";
}

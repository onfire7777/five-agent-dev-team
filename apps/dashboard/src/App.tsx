import { useEffect, useMemo, useState } from "react";
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

type Status = ReturnType<typeof createSampleStatus>;

const API_BASE = "http://localhost:4310";

const agentRows = [
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

const pipelineOrder = [
  ["INTAKE", "Intake"],
  ["RND", "R&D"],
  ["FRONTEND_BUILD", "Frontend"],
  ["BACKEND_BUILD", "Backend"],
  ["VERIFY", "Verify"],
  ["RELEASE", "Release"]
] as const;

export function App() {
  const [status, setStatus] = useState<Status>(() => createSampleStatus());
  const [loading, setLoading] = useState(false);
  const [selectedWorkItem, setSelectedWorkItem] = useState("WI-1290");

  async function loadStatus() {
    try {
      const response = await fetch(`${API_BASE}/api/status`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus(await response.json());
    } catch {
      setStatus(createSampleStatus());
    }
  }

  useEffect(() => {
    loadStatus();
    const timer = window.setInterval(loadStatus, 10000);
    return () => window.clearInterval(timer);
  }, []);

  async function toggleEmergencyStop() {
    setLoading(true);
    try {
      const path = status.system.emergencyStop ? "/api/emergency-resume" : "/api/emergency-stop";
      await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Operator dashboard stop" })
      });
      await loadStatus();
    } finally {
      setLoading(false);
    }
  }

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
          <strong><span className="dot green" /> Production</strong>
          <small>Controller v0.1.0</small>
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
            <Metric icon={GitBranch} label="GitHub" value={status.system.githubSync} ok />
          </div>
        </header>

        <section className="hero-band">
          <div>
            <span className="status-chip"><span className="dot green" /> Operational</span>
            <h2>Fully autonomous team, parallel where it is safe.</h2>
            <p>Designed for ChatGPT Pro plus Codex-style usage: event-triggered stages, controlled parallelism, cooldowns, and release autonomy when local checks, GitHub Actions, security, privacy, rollback, and sync gates are provably clean.</p>
          </div>
          <button className="primary-action" onClick={loadStatus}>
            <RefreshCw size={16} />
            Refresh State
          </button>
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
                  <span className={agent.status === "Blocked" ? "status warn" : "status ok"}>
                    <span className={`dot ${agent.status === "Blocked" ? "amber" : "green"}`} />
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

            <section className="readiness">
              <div className="release-icon"><Check size={22} /></div>
              <h3>Ready for Release</h3>
              <p>All configured autonomous gates are currently passing.</p>
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
                <div><dt>Default Branch</dt><dd>main</dd></div>
                <div><dt>Sync Status</dt><dd><span className="dot green" /> Synced</dd></div>
                <div><dt>Behind / Ahead</dt><dd>0 / 0</dd></div>
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
              <select value={selected?.id} onChange={(event) => setSelectedWorkItem(event.target.value)}>
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

function describeStage(stage: string) {
  const descriptions: Record<string, string> = {
    INTAKE: "scope and route",
    RND: "research and contract",
    FRONTEND_BUILD: "client work",
    BACKEND_BUILD: "system work",
    VERIFY: "quality gates",
    RELEASE: "merge and publish"
  };
  return descriptions[stage] || "workflow";
}

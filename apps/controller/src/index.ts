import "dotenv/config";
import childProcess from "node:child_process";
import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import util from "node:util";
import YAML from "yaml";
import { z } from "zod";
import { createStore } from "./store";
import { checkTemporalConnection, startAutonomousWorkflow } from "./temporal";
import { startSmartScheduler } from "./scheduler";
import { loadTargetRepoConfig, ProjectConnectionInputSchema, targetRepoConfigFromProjectConnection, type ProjectConnection, type ProjectConnectionInput } from "../../../packages/shared/src";

const CreateWorkItemRequest = z.object({
  title: z.string().min(1),
  requestType: z.enum(["feature", "bug", "performance", "security", "privacy", "refactor", "research"]).default("feature"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dependencies: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
  frontendNeeded: z.boolean().default(true),
  backendNeeded: z.boolean().default(true),
  rndNeeded: z.boolean().default(true),
  projectId: z.string().min(1).optional(),
  repo: z.string().min(1).optional()
});

const app = express();
const store = createStore();
const port = Number(process.env.PORT || 4310);
const execFile = util.promisify(childProcess.execFile);
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

class HttpError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}

function boundedInteger(value: unknown, defaultValue: number, min: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function requireConnectedTargetRepo(): void {
  if (/^(1|true|yes)$/i.test(process.env.AGENT_TEAM_ALLOW_DEFAULT_CONFIG || "")) return;
  const configPath = process.env.AGENT_TEAM_CONFIG || "agent-team.config.yaml";
  try {
    loadTargetRepoConfig(configPath);
  } catch (error) {
    throw new HttpError([
      `Target repo config could not be loaded from ${configPath}.`,
      "Connect a target repository before starting autonomous work."
    ].join(" "), 400);
  }
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new HttpError(`Origin ${origin} is not allowed by CORS policy.`, 403));
  }
}));
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await store.getStatus();
    await checkTemporalConnection();
    res.json({
      ok: true,
      service: "agent-team-controller",
      postgres: "ok",
      temporal: process.env.TEMPORAL_ADDRESS ? "ok" : "not_configured"
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: "agent-team-controller",
      error: error instanceof Error ? error.message : "health check failed"
    });
  }
});

app.get("/api/status", async (_req, res, next) => {
  try {
    res.json(await store.getStatus());
  } catch (error) {
    next(error);
  }
});

app.get("/api/work-items", async (_req, res, next) => {
  try {
    res.json(await store.listWorkItems());
  } catch (error) {
    next(error);
  }
});

app.get("/api/memories", async (req, res, next) => {
  try {
    const workItemId = typeof req.query.workItemId === "string" ? req.query.workItemId : undefined;
    res.json(await store.listMemories(workItemId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/events", async (req, res, next) => {
  try {
    const after = boundedInteger(req.query.after, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = boundedInteger(req.query.limit, 50, 1, 100);
    res.json(await store.listEvents(after, limit));
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects", async (_req, res, next) => {
  try {
    res.json(await store.listProjectConnections());
  } catch (error) {
    next(error);
  }
});

app.get("/api/github/status", async (req, res, next) => {
  try {
    const input = ProjectConnectionInputSchema.parse({
      repoOwner: req.query.repoOwner,
      repoName: req.query.repoName,
      defaultBranch: req.query.defaultBranch || "main",
      localPath: req.query.localPath,
      webResearchEnabled: req.query.webResearchEnabled === undefined ? true : /^(1|true|yes)$/i.test(String(req.query.webResearchEnabled)),
      githubMcpEnabled: req.query.githubMcpEnabled === undefined ? true : /^(1|true|yes)$/i.test(String(req.query.githubMcpEnabled)),
      active: true
    });
    res.json(await inspectProjectConnection(input));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", async (req, res, next) => {
  try {
    const input = ProjectConnectionInputSchema.parse(req.body);
    const diagnostics = await inspectProjectConnection(input);
    const project = await store.upsertProjectConnection({ ...input, ...diagnostics });
    if (project.active) await writeTargetRepoConfig(project);
    await store.addEvent({
      level: project.status === "connected" ? "info" : "warn",
      type: "system",
      message: `Connected project ${project.name} to ${project.repo}; GitHub status=${project.status}.`
    });
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:id/activate", async (req, res, next) => {
  try {
    const activated = await store.activateProjectConnection(req.params.id);
    const diagnostics = await inspectProjectConnection(activated);
    const project = await store.upsertProjectConnection({ ...activated, active: true, ...diagnostics });
    await writeTargetRepoConfig(project);
    await store.addEvent({
      level: project.status === "connected" ? "info" : "warn",
      type: "system",
      message: `Activated project ${project.name} for isolated autonomous work; GitHub status=${project.status}.`
    });
    res.json(project);
  } catch (error) {
    next(error);
  }
});

app.get("/api/events/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let lastSequence = boundedInteger(req.query.after, 0, 0, Number.MAX_SAFE_INTEGER);

  const sendEvents = async (): Promise<boolean> => {
    const events = await store.listEvents(lastSequence, 50);
    let wrote = false;
    for (const event of events) {
      lastSequence = event.sequence;
      res.write(`id: ${event.sequence}\n`);
      res.write(`event: agent-event\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      wrote = true;
    }
    return wrote;
  };

  const sendHeartbeat = () => {
    res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
  };

  const timer = setInterval(() => {
    sendEvents()
      .then((wrote) => {
        if (!wrote) sendHeartbeat();
      })
      .catch((error) => {
        res.write(`event: stream-error\n`);
        res.write(`data: ${JSON.stringify({ error: error instanceof Error ? error.message : "event stream failed" })}\n\n`);
      });
  }, 2000);

  const wroteInitialEvents = await sendEvents().catch(() => false);
  if (!wroteInitialEvents) sendHeartbeat();
  req.on("close", () => clearInterval(timer));
});

async function writeTargetRepoConfig(project: ProjectConnection): Promise<void> {
  const config = targetRepoConfigFromProjectConnection(project);
  await fs.writeFile(process.env.AGENT_TEAM_CONFIG || "agent-team.config.yaml", YAML.stringify(config), "utf8");
}

type ProjectConnectionDiagnostics = Partial<Pick<ProjectConnection, "remoteUrl" | "ghAvailable" | "ghAuthed" | "githubConnected" | "remoteMatches" | "defaultBranchVerified" | "validationErrors" | "lastValidatedAt" | "status">>;

async function inspectProjectConnection(input: ProjectConnectionInput): Promise<ProjectConnectionDiagnostics> {
  const validationErrors: string[] = [];
  const expectedRepo = `${input.repoOwner}/${input.repoName}`.toLowerCase();
  const defaultBranch = input.defaultBranch || "main";
  const now = new Date().toISOString();
  const diagnostics: ProjectConnectionDiagnostics = {
    ghAvailable: false,
    ghAuthed: false,
    githubConnected: false,
    remoteMatches: false,
    defaultBranchVerified: false,
    validationErrors,
    lastValidatedAt: now,
    status: "connected"
  };

  try {
    const stat = await fs.stat(input.localPath);
    if (!stat.isDirectory()) {
      validationErrors.push("Local path is not a directory.");
      return { ...diagnostics, status: "missing_local_path" };
    }
  } catch {
    validationErrors.push("Local path does not exist or is not accessible from this runtime.");
    return { ...diagnostics, status: "missing_local_path" };
  }

  const insideGit = await runTool("git", ["rev-parse", "--is-inside-work-tree"], input.localPath);
  if (!insideGit.ok || insideGit.stdout.trim() !== "true") {
    validationErrors.push("Local path is not a git work tree.");
    return { ...diagnostics, status: "not_git_repo" };
  }

  const remote = await runTool("git", ["remote", "get-url", "origin"], input.localPath);
  if (remote.ok) {
    diagnostics.remoteUrl = remote.stdout.trim();
    const parsed = parseGitHubRemote(diagnostics.remoteUrl);
    diagnostics.remoteMatches = parsed ? `${parsed.owner}/${parsed.repo}`.toLowerCase() === expectedRepo : false;
    if (!diagnostics.remoteMatches) {
      validationErrors.push(`Origin remote does not match ${input.repoOwner}/${input.repoName}.`);
    }
  } else {
    validationErrors.push("Git origin remote could not be read.");
  }

  const ghVersion = await runTool("gh", ["--version"], input.localPath);
  diagnostics.ghAvailable = ghVersion.ok;
  if (!diagnostics.ghAvailable) {
    validationErrors.push("GitHub CLI is not available in this runtime.");
  } else {
    const authStatus = await runTool("gh", ["auth", "status", "--hostname", "github.com"], input.localPath);
    diagnostics.ghAuthed = authStatus.ok || Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN);
    if (!diagnostics.ghAuthed) {
      validationErrors.push("GitHub CLI is not authenticated. Set GH_TOKEN/GITHUB_TOKEN or mount gh config.");
    }

    const repoView = await runTool("gh", ["repo", "view", `${input.repoOwner}/${input.repoName}`, "--json", "name,owner,url,defaultBranchRef"], input.localPath);
    if (repoView.ok) {
      try {
        const data = JSON.parse(repoView.stdout || "{}") as {
          name?: string;
          url?: string;
          owner?: { login?: string };
          defaultBranchRef?: { name?: string };
        };
        diagnostics.githubConnected = `${data.owner?.login || ""}/${data.name || ""}`.toLowerCase() === expectedRepo;
        diagnostics.defaultBranchVerified = (data.defaultBranchRef?.name || defaultBranch) === defaultBranch;
        if (data.url) diagnostics.remoteUrl ||= data.url;
      } catch {
        validationErrors.push("GitHub CLI repo response could not be parsed.");
      }
    } else if (diagnostics.ghAuthed) {
      validationErrors.push(`GitHub repository ${input.repoOwner}/${input.repoName} could not be read with gh.`);
    }
  }

  if (!diagnostics.defaultBranchVerified) {
    const branch = await runTool("git", ["ls-remote", "--exit-code", "--heads", "origin", defaultBranch], input.localPath);
    diagnostics.defaultBranchVerified = branch.ok;
    if (!branch.ok) validationErrors.push(`Default branch ${defaultBranch} was not verified on origin.`);
  }

  const status = !diagnostics.remoteMatches && !diagnostics.githubConnected
    ? "remote_mismatch"
    : !diagnostics.ghAvailable || !diagnostics.ghAuthed
      ? "needs_github_auth"
      : "connected";

  return {
    ...diagnostics,
    status,
    validationErrors
  };
}

async function runTool(command: string, args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const result = await execFile(command, args, {
      cwd,
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as Error & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: failed.stdout || "",
      stderr: failed.stderr || failed.message
    };
  }
}

function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim().replace(/\.git$/i, "");
  const https = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (https) return { owner: https[1], repo: https[2] };
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const sshUrl = trimmed.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/i);
  if (sshUrl) return { owner: sshUrl[1], repo: sshUrl[2] };
  return null;
}

app.post("/api/work-items", async (req, res, next) => {
  try {
    requireConnectedTargetRepo();
    const input = CreateWorkItemRequest.parse(req.body);
    const workItem = await store.createWorkItem(input);
    const currentStatus = await store.getStatus();
    if (currentStatus.system.emergencyStop) {
      res.status(202).json({
        workItem,
        workflowId: null,
        blocked: true,
        reason: currentStatus.system.emergencyReason || "Emergency stop is active"
      });
      return;
    }

    const claimed = await store.claimWorkItemForWorkflow(workItem.id);
    if (!claimed) throw new HttpError(`Work item ${workItem.id} is already claimed by an active workflow.`, 409);
    await store.addEvent({
      workItemId: workItem.id,
      stage: "NEW",
      ownerAgent: "product-delivery-orchestrator",
      level: "info",
      type: "workflow_claimed",
      message: `Workflow claimed for ${workItem.title}.`
    });
    const workflowId = claimed ? await startAutonomousWorkflow(workItem) : null;
    if (workflowId) {
      await store.updateWorkItemState(workItem.id, "INTAKE");
    } else {
      await store.releaseWorkItemWorkflowClaim(workItem.id);
    }
    const responseWorkItem = workflowId
      ? { ...workItem, state: "INTAKE" as const, updatedAt: new Date().toISOString() }
      : workItem;
    res.status(201).json({ workItem: responseWorkItem, workflowId });
  } catch (error) {
    next(error);
  }
});

app.post("/api/emergency-stop", async (req, res, next) => {
  try {
    await store.setEmergencyStop(true, String(req.body?.reason || "Operator emergency stop"));
    res.json({ emergencyStop: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/emergency-resume", async (_req, res, next) => {
  try {
    await store.setEmergencyStop(false);
    res.json({ emergencyStop: false });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: message });
    return;
  }
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  res.status(statusCode).json({ error: message });
});

store.init().then(() => {
  startSmartScheduler(store);
  app.listen(port, () => {
    console.log(`AI Dev Team controller listening on http://localhost:${port}`);
  });
});

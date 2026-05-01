import "dotenv/config";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import util from "node:util";
import YAML from "yaml";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import {
  createStore,
  type Direction,
  type LoopRun,
  type Opportunity,
  type Proposal,
  type StrictProjectScope,
  type TeamBusMessage as StoreTeamBusMessage
} from "./store";
import { checkTemporalConnection, signalProposalDecision, startAutonomousWorkflow } from "./temporal";
import { startSmartScheduler } from "./scheduler";
import {
  canTransition,
  EmergencyControlRequestSchema,
  ProjectCapabilityStatusSchema,
  ProjectConnectionInputSchema,
  OpportunityScanRunSchema,
  WorkItemStateSchema,
  loadTargetRepoConfig,
  targetRepoConfigFromProjectConnection,
  type ProjectCapabilityStatus,
  type ProjectConnection,
  type ProjectConnectionInput,
  type WorkItem
} from "../../../packages/shared/src";
import {
  deleteStoredGitHubAuth,
  githubAuthEnv,
  githubAuthFilePath,
  githubToken,
  githubTokenSource,
  writeStoredGitHubAuth
} from "../../../packages/shared/src/github-auth";

const CreateWorkItemRequest = z.object({
  title: z.string().min(1),
  requestType: z
    .enum(["feature", "bug", "performance", "security", "privacy", "refactor", "research"])
    .default("feature"),
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

const ProjectScopeRequest = z.object({
  projectId: z.string().min(1),
  repo: z.string().min(1)
});

const TeamBusMessageRequest = ProjectScopeRequest.extend({
  id: z.string().min(1).optional(),
  workItemId: z.string().min(1).optional(),
  loopRunId: z.string().min(1).optional(),
  from: z.string().min(1),
  to: z.array(z.string().min(1)).default([]),
  kind: z.enum(["note", "handoff", "decision", "blocker", "status"]),
  topic: z.string().min(1),
  body: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({})
});

const LoopRunRequest = ProjectScopeRequest.extend({
  id: z.string().min(1).optional(),
  workItemId: z.string().min(1).optional(),
  directionId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  proposalId: z.string().min(1).optional(),
  status: z.enum(["running", "awaiting_acceptance", "blocked", "closed", "failed"]).optional(),
  summary: z.string().optional(),
  closedAt: z.string().datetime().optional()
});

const DirectionRequest = ProjectScopeRequest.extend({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  summary: z.string().min(1),
  goals: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([])
});

const OpportunityRequest = ProjectScopeRequest.extend({
  id: z.string().min(1).optional(),
  workItemId: z.string().min(1).optional(),
  title: z.string().min(1),
  summary: z.string().min(1),
  source: z.enum(["operator", "agent", "github", "research", "system"]).default("operator"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  status: z.enum(["new", "evaluating", "proposed", "accepted", "rejected"]).default("new"),
  tags: z.array(z.string()).default([])
});

const ProposalOptionRequest = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  tradeoffs: z.array(z.string()).default([])
});

const ProposalRequest = ProjectScopeRequest.extend({
  id: z.string().min(1).optional(),
  workItemId: z.string().min(1).optional(),
  loopRunId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  title: z.string().min(1),
  summary: z.string().min(1),
  researchFindings: z.array(z.string()).default([]),
  options: z.array(ProposalOptionRequest).default([]),
  recommendation: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).default([]),
  implementationPlan: z.array(z.string()).default([]),
  validationPlan: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  status: z.enum(["draft", "proposed", "accepted", "revising", "rejected"]).default("proposed")
});

const ProposalDecisionRequest = ProjectScopeRequest.extend({
  decision: z.enum(["accept", "revise", "reject"]),
  decidedBy: z.string().min(1),
  reason: z.string().min(1),
  requestedChanges: z.array(z.string()).default([])
});

const DirectionAliasRequest = z.object({
  mode: z.enum(["next_loop", "standing"]).default("next_loop"),
  instruction: z.string().min(1),
  pauseNewLoopsAfterCurrent: z.boolean().default(false)
});

const WorkItemProposalDecisionRequest = z.object({
  feedback: z.string().optional()
});

const app = express();
const store = createStore();
const port = Number(process.env.PORT || 4310);
const host = process.env.HOST || "127.0.0.1";
const execFile = util.promisify(childProcess.execFile);
const githubDeviceSessions = new Map<
  string,
  {
    clientId: string;
    deviceCode: string;
    interval: number;
    scope: string;
    expiresAt: number;
  }
>();
const allowedOrigins = (process.env.CORS_ORIGINS || "http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

class HttpError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
  }
}

function strictIntegerQuery(value: unknown, name: string, defaultValue: number, min: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new HttpError(`${name} must be an integer greater than or equal to ${min}.`, 400);
  }
  return Math.min(parsed, max);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new HttpError(`Origin ${origin} is not allowed by CORS policy.`, 403));
    }
  })
);
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await store.getStatus();
    await checkTemporalConnection();
    res.json({
      ok: true,
      service: "agent-team-controller",
      services: {
        postgres: "ok",
        temporal: process.env.TEMPORAL_ADDRESS ? "ok" : "not_configured"
      },
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

app.get("/api/work-items", async (req, res, next) => {
  try {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const state = typeof req.query.state === "string" ? WorkItemStateSchema.parse(req.query.state) : undefined;
    const workItems = (await store.listWorkItems()).filter(
      (item) => (!projectId || item.projectId === projectId) && (!state || item.state === state)
    );
    res.json(workItems);
  } catch (error) {
    next(error);
  }
});

app.get("/api/work-items/:id", async (req, res, next) => {
  try {
    const result = await store.getWorkItemWithArtifacts(req.params.id);
    if (!result) throw new HttpError(`Work item ${req.params.id} was not found.`, 404);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/artifacts/:id", async (req, res, next) => {
  try {
    const artifact = await store.getArtifact(req.params.id);
    if (!artifact) throw new HttpError(`Artifact ${req.params.id} was not found.`, 404);
    res.json(artifact);
  } catch (error) {
    next(error);
  }
});

app.get("/api/memories", async (req, res, next) => {
  try {
    const workItemId = typeof req.query.workItemId === "string" ? req.query.workItemId : undefined;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const memories = await store.listMemories(workItemId);
    res.json(projectId ? memories.filter((memory) => memory.projectId === projectId) : workItemId ? memories : []);
  } catch (error) {
    next(error);
  }
});

app.get("/api/events", async (req, res, next) => {
  try {
    const after = strictIntegerQuery(req.query.after, "after", 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = strictIntegerQuery(req.query.limit, "limit", 50, 1, 500);
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

app.get("/api/team-bus", async (req, res, next) => {
  try {
    const scope = await requireStrictProjectScope(req.query);
    res.json(await store.listTeamBusMessages(scope));
  } catch (error) {
    next(error);
  }
});

app.post("/api/team-bus", async (req, res, next) => {
  try {
    const input = TeamBusMessageRequest.parse(req.body);
    const scope = await requireStrictProjectScope(input);
    const message = await store.addTeamBusMessage(scope, input);
    await store.addEvent({
      workItemId: message.workItemId,
      level: message.kind === "blocker" ? "warn" : "info",
      type: "system",
      message: `Team bus ${message.kind}: ${message.topic}`
    });
    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
});

app.get("/api/loop-runs", async (req, res, next) => {
  try {
    const scope = await requireStrictProjectScope(req.query);
    res.json(await store.listLoopRuns(scope));
  } catch (error) {
    next(error);
  }
});

app.post("/api/loop-runs", async (req, res, next) => {
  try {
    const input = LoopRunRequest.parse(req.body);
    const scope = await requireStrictProjectScope(input);
    const run = await store.upsertLoopRun(scope, input);
    res.status(input.id ? 200 : 201).json(run);
  } catch (error) {
    next(error);
  }
});

app.get("/api/direction", async (req, res, next) => {
  try {
    const scope = await requireStrictProjectScope(req.query);
    const direction = await store.getDirection(scope);
    if (!direction) {
      res.status(404).json({ error: `Direction was not found for ${scope.projectId}.` });
      return;
    }
    res.json(direction);
  } catch (error) {
    next(error);
  }
});

app.put("/api/direction", async (req, res, next) => {
  try {
    const input = DirectionRequest.parse(req.body);
    const scope = await requireStrictProjectScope(input);
    res.json(await store.upsertDirection(scope, input));
  } catch (error) {
    next(error);
  }
});

app.get("/api/opportunities", async (req, res, next) => {
  try {
    const scope = await requireStrictProjectScope(req.query);
    res.json(await store.listOpportunities(scope));
  } catch (error) {
    next(error);
  }
});

app.post("/api/opportunities", async (req, res, next) => {
  try {
    const input = OpportunityRequest.parse(req.body);
    const scope = await requireStrictProjectScope(input);
    const opportunity = await store.upsertOpportunity(scope, input);
    res.status(input.id ? 200 : 201).json(opportunity);
  } catch (error) {
    next(error);
  }
});

app.get("/api/proposals", async (req, res, next) => {
  try {
    const scope = await requireStrictProjectScope(req.query);
    res.json(await store.listProposals(scope));
  } catch (error) {
    next(error);
  }
});

app.post("/api/proposals", async (req, res, next) => {
  try {
    const input = ProposalRequest.parse(req.body);
    const scope = await requireStrictProjectScope(input);
    const proposal = await store.upsertProposal(scope, input);
    res.status(input.id ? 200 : 201).json(proposal);
  } catch (error) {
    next(error);
  }
});

app.post("/api/proposals/:id/decision", async (req, res, next) => {
  try {
    const input = ProposalDecisionRequest.parse(req.body);
    res.json(await decideProposalById(req.params.id, input));
  } catch (error) {
    next(error);
  }
});

app.post("/api/proposals/:id/accept", async (req, res, next) => {
  try {
    const input = ProposalDecisionRequest.parse({ ...req.body, decision: "accept" });
    res.json(await decideProposalById(req.params.id, input));
  } catch (error) {
    next(error);
  }
});

app.post("/api/proposals/:id/revise", async (req, res, next) => {
  try {
    const input = ProposalDecisionRequest.parse({ ...req.body, decision: "revise" });
    res.json(await decideProposalById(req.params.id, input));
  } catch (error) {
    next(error);
  }
});

app.post("/api/proposals/:id/reject", async (req, res, next) => {
  try {
    const input = ProposalDecisionRequest.parse({ ...req.body, decision: "reject" });
    res.json(await decideProposalById(req.params.id, input));
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/team-bus", async (req, res, next) => {
  try {
    const scope = await requireScopeForProjectId(req.params.projectId);
    const messages = await store.listTeamBusMessages(scope);
    res.json({ messages: messages.map(mapTeamBusMessageForUi) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/loop-runs", async (req, res, next) => {
  try {
    const scope = await requireScopeForProjectId(req.params.projectId);
    const loopRuns = await store.listLoopRuns(scope);
    res.json({ loopRuns: loopRuns.map(mapLoopRunForUi) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/direction", async (req, res, next) => {
  try {
    const scope = await requireScopeForProjectId(req.params.projectId);
    const direction = await store.getDirection(scope);
    res.json({ direction: direction ? mapDirectionForUi(direction) : null });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/direction", async (req, res, next) => {
  try {
    const scope = await requireScopeForProjectId(req.params.projectId);
    const input = DirectionAliasRequest.parse(req.body);
    const title = input.mode === "standing" ? "Standing direction" : "Next loop direction";
    const direction = await store.upsertDirection(scope, {
      title,
      summary: input.instruction,
      goals: [input.instruction],
      constraints: input.pauseNewLoopsAfterCurrent ? ["Pause new loops after current"] : [],
      acceptanceCriteria: []
    });
    await store.addEvent({
      level: "info",
      type: "system",
      message: `${title} saved for ${scope.repo}.`
    });
    res.status(201).json({ direction: mapDirectionForUi(direction, input) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/opportunities", async (req, res, next) => {
  try {
    const scope = await requireScopeForProjectId(req.params.projectId);
    const opportunities = await store.listOpportunities(scope);
    res.json({ opportunities: opportunities.map(mapOpportunityForUi) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/opportunities/scan", async (req, res, next) => {
  let scope: StrictProjectScope | undefined;
  let scanId: string | undefined;
  try {
    scope = await requireScopeForProjectId(req.params.projectId);
    const startedAt = new Date().toISOString();
    const runningScan = await store.upsertOpportunityScanRun(scope, {
      status: "running",
      sources: [],
      candidatesCreated: 0,
      summary: "Opportunity scan started.",
      startedAt
    });
    scanId = runningScan.id;
    const result = await scanLeanOpportunity(scope);
    const opportunities = await store.listOpportunities(scope);
    const scan = OpportunityScanRunSchema.parse(
      await store.upsertOpportunityScanRun(scope, {
        id: scanId,
        status: "complete",
        sources: result.sources,
        candidatesCreated: result.created ? 1 : 0,
        summary: result.created
          ? `Created opportunity candidate ${result.opportunity.id}.`
          : `Reused existing opportunity candidate ${result.opportunity.id}.`,
        startedAt: runningScan.startedAt,
        completedAt: new Date().toISOString()
      })
    );
    res.status(201).json({
      scan,
      opportunity: mapOpportunityForUi(result.opportunity),
      opportunities: opportunities.map(mapOpportunityForUi)
    });
  } catch (error) {
    if (scope && scanId) {
      await store
        .upsertOpportunityScanRun(scope, {
          id: scanId,
          status: "failed",
          summary: "Opportunity scan failed before completion.",
          completedAt: new Date().toISOString()
        })
        .catch(() => undefined);
    }
    next(error);
  }
});

app.post("/api/opportunities/:id/promote", async (req, res, next) => {
  try {
    const { scope, opportunity } = await findOpportunityById(req.params.id);
    const existingWorkItem = opportunity.workItemId
      ? (await store.listWorkItems()).find((item) => item.id === opportunity.workItemId)
      : undefined;
    const workItem =
      existingWorkItem ||
      (await store.createWorkItem({
        title: opportunity.title,
        requestType: "feature",
        priority: opportunity.priority,
        dependencies: [],
        acceptanceCriteria: [opportunity.summary],
        riskLevel: opportunity.priority === "urgent" || opportunity.priority === "high" ? "high" : "medium",
        frontendNeeded: true,
        backendNeeded: true,
        rndNeeded: true,
        projectId: scope.projectId,
        repo: scope.repo
      }));
    const updated = await store.upsertOpportunity(scope, {
      ...opportunity,
      workItemId: workItem.id,
      status: "accepted",
      tags: [...new Set([...opportunity.tags, "promoted"])]
    });
    await store.addTeamBusMessage(scope, {
      workItemId: workItem.id,
      from: "product-delivery-orchestrator",
      kind: "handoff",
      topic: "Opportunity promoted",
      body: `Promoted ${opportunity.title} into ${workItem.id}.`,
      payload: { opportunityId: opportunity.id }
    });

    const started = await startWorkflowIfSafe(workItem);
    res.status(201).json({
      opportunity: mapOpportunityForUi(updated),
      workItem,
      workflowId: started.workflowId,
      queued: started.queued,
      reason: started.reason
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/work-items/:id/proposal", async (req, res, next) => {
  try {
    const { scope, workItem } = await requireScopeForWorkItem(req.params.id);
    const proposal = await findLatestProposalForWorkItem(scope, workItem.id);
    res.json({ proposal: proposal ? mapProposalForUi(proposal) : null });
  } catch (error) {
    next(error);
  }
});

app.post("/api/work-items/:id/proposal/accept", async (req, res, next) => {
  try {
    const result = await decideWorkItemProposal(req.params.id, "accept", req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/work-items/:id/proposal/revise", async (req, res, next) => {
  try {
    const result = await decideWorkItemProposal(req.params.id, "revise", req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/work-items/:id/proposal/reject", async (req, res, next) => {
  try {
    const result = await decideWorkItemProposal(req.params.id, "reject", req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/github/account", async (_req, res, next) => {
  try {
    res.json(await getGitHubAccountStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/github/device/start", async (_req, res, next) => {
  try {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
    if (!clientId) {
      throw new HttpError("Set GITHUB_OAUTH_CLIENT_ID to enable dashboard GitHub account connection.", 400);
    }
    const scope = process.env.GITHUB_OAUTH_SCOPES?.trim() || "";
    const body = new URLSearchParams({ client_id: clientId });
    if (scope) body.set("scope", scope);
    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      signal: AbortSignal.timeout(10_000)
    });
    const data = (await response.json()) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      verification_uri_complete?: string;
      expires_in?: number;
      interval?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || data.error || !data.device_code || !data.user_code || !data.verification_uri) {
      throw new HttpError(data.error_description || data.error || "GitHub device authorization could not start.", 502);
    }
    const sessionId = crypto.randomUUID();
    const expiresIn = Number(data.expires_in || 900);
    const interval = Math.max(Number(data.interval || 5), 5);
    githubDeviceSessions.set(sessionId, {
      clientId,
      deviceCode: data.device_code,
      interval,
      scope,
      expiresAt: Date.now() + expiresIn * 1000
    });
    res.status(201).json({
      sessionId,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      verificationUriComplete: data.verification_uri_complete,
      expiresIn,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      interval,
      scope
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/github/device/poll", async (req, res, next) => {
  try {
    const { sessionId } = z.object({ sessionId: z.string().min(1) }).parse(req.body);
    const session = githubDeviceSessions.get(sessionId);
    if (!session) throw new HttpError("GitHub connection session was not found. Start a new connection.", 404);
    if (Date.now() > session.expiresAt) {
      githubDeviceSessions.delete(sessionId);
      res.status(410).json({ status: "expired", message: "GitHub connection code expired. Start again." });
      return;
    }

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: session.clientId,
        device_code: session.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      }),
      signal: AbortSignal.timeout(10_000)
    });
    const data = (await response.json()) as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
      interval?: number;
    };

    if (data.error === "authorization_pending") {
      res.json({ status: "pending", interval: session.interval, message: "Waiting for GitHub approval." });
      return;
    }
    if (data.error === "slow_down") {
      session.interval = Math.max(Number(data.interval || session.interval + 5), session.interval + 5);
      res.json({ status: "pending", interval: session.interval, message: "GitHub asked us to slow polling." });
      return;
    }
    if (data.error) {
      githubDeviceSessions.delete(sessionId);
      res.json({
        status: data.error === "access_denied" ? "denied" : "failed",
        message: data.error_description || data.error
      });
      return;
    }
    if (!response.ok || !data.access_token) {
      throw new HttpError("GitHub did not return an access token.", 502);
    }

    const user = await fetchGitHubUser(data.access_token);
    await writeStoredGitHubAuth({
      accessToken: data.access_token,
      tokenType: data.token_type || "bearer",
      scope: data.scope || session.scope,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl
    });
    githubDeviceSessions.delete(sessionId);
    await store.addEvent({
      level: "info",
      type: "system",
      message: `GitHub account ${user.login} connected through dashboard device authorization.`
    });
    res.json({ status: "connected", account: await getGitHubAccountStatus() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/github/disconnect", async (_req, res, next) => {
  try {
    const source = githubTokenSource();
    if (source?.source === "local") {
      await deleteStoredGitHubAuth();
      await store.addEvent({
        level: "warn",
        type: "system",
        message: "Dashboard-managed GitHub account disconnected."
      });
      res.json({
        disconnected: true,
        message: "Dashboard-managed GitHub account disconnected.",
        account: await getGitHubAccountStatus()
      });
      return;
    }
    res.json({
      disconnected: false,
      message:
        source?.source === "env"
          ? `GitHub auth is managed by ${source.sourceName}; remove that environment token to disconnect.`
          : "No dashboard-managed GitHub account is connected.",
      account: await getGitHubAccountStatus()
    });
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
      webResearchEnabled:
        req.query.webResearchEnabled === undefined
          ? true
          : /^(1|true|yes)$/i.test(String(req.query.webResearchEnabled)),
      githubMcpEnabled:
        req.query.githubMcpEnabled === undefined ? true : /^(1|true|yes)$/i.test(String(req.query.githubMcpEnabled)),
      githubWriteEnabled:
        req.query.githubWriteEnabled === undefined
          ? false
          : /^(1|true|yes)$/i.test(String(req.query.githubWriteEnabled)),
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

app.delete("/api/projects/:id", async (req, res, next) => {
  try {
    const project = await store.deactivateProjectConnection(req.params.id);
    await removeTargetRepoConfig(project);
    await store.addEvent({
      level: "info",
      type: "system",
      message: `Deactivated project ${project.name} for ${project.repo}.`
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

  let lastSequence: number;
  try {
    lastSequence = strictIntegerQuery(req.query.after, "after", 0, 0, Number.MAX_SAFE_INTEGER);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid event stream cursor.";
    res.write(`event: stream-error\n`);
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
    return;
  }

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
        res.write(
          `data: ${JSON.stringify({ error: error instanceof Error ? error.message : "event stream failed" })}\n\n`
        );
      });
  }, 15_000);

  const wroteInitialEvents = await sendEvents().catch(() => false);
  if (!wroteInitialEvents) sendHeartbeat();
  req.on("close", () => clearInterval(timer));
});

async function writeTargetRepoConfig(project: ProjectConnection): Promise<void> {
  const config = targetRepoConfigFromProjectConnection(project);
  const yaml = YAML.stringify(config);
  await fs.writeFile(process.env.AGENT_TEAM_CONFIG || "agent-team.config.yaml", yaml, "utf8");
  const projectConfigDir = process.env.AGENT_TEAM_PROJECT_CONFIG_DIR || ".agent-team/projects";
  await fs.mkdir(projectConfigDir, { recursive: true });
  await fs.writeFile(path.join(projectConfigDir, `${safeFileSegment(project.projectId)}.yaml`), yaml, "utf8");
}

async function removeTargetRepoConfig(project: ProjectConnection): Promise<void> {
  const projectConfigDir = process.env.AGENT_TEAM_PROJECT_CONFIG_DIR || ".agent-team/projects";
  await fs.rm(path.join(projectConfigDir, `${safeFileSegment(project.projectId)}.yaml`), { force: true });

  const configPath = process.env.AGENT_TEAM_CONFIG || "agent-team.config.yaml";
  try {
    const config = loadTargetRepoConfig(configPath);
    const matchesDeactivatedProject =
      config.project.id === project.projectId &&
      config.repo.owner === project.repoOwner &&
      config.repo.name === project.repoName;
    if (matchesDeactivatedProject) await fs.rm(configPath, { force: true });
  } catch {
    // If the global config is absent or invalid, the project-scoped cleanup above is still sufficient.
  }
}

type ProjectConnectionDiagnostics = Partial<
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

async function inspectProjectConnection(input: ProjectConnectionInput): Promise<ProjectConnectionDiagnostics> {
  const validationErrors: string[] = [];
  const expectedRepo = `${input.repoOwner}/${input.repoName}`.toLowerCase();
  const defaultBranch = input.defaultBranch || "main";
  const now = new Date().toISOString();
  const diagnostics: ProjectConnectionDiagnostics = {
    ghAvailable: false,
    ghAuthed: false,
    githubMcpAvailable: false,
    githubMcpAuthenticated: false,
    githubSdkConnected: false,
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
  diagnostics.githubCliVersion = ghVersion.ok ? firstLine(ghVersion.stdout) : undefined;
  if (!diagnostics.ghAvailable) {
    validationErrors.push("GitHub CLI is not available in this runtime.");
  } else {
    const authStatus = await runTool("gh", ["auth", "status", "--hostname", "github.com"], input.localPath);
    diagnostics.ghAuthed = authStatus.ok || Boolean(githubToken());
    if (!diagnostics.ghAuthed) {
      validationErrors.push(
        "GitHub CLI is not authenticated. Connect GitHub in the dashboard, set GH_TOKEN/GITHUB_TOKEN, or mount gh config."
      );
    }

    const repoView = await runTool(
      "gh",
      ["repo", "view", `${input.repoOwner}/${input.repoName}`, "--json", "name,owner,url,defaultBranchRef"],
      input.localPath
    );
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

  const mcpVersion = await runTool("github-mcp-server", ["--version"], input.localPath);
  diagnostics.githubMcpAvailable = mcpVersion.ok;
  diagnostics.githubMcpVersion = mcpVersion.ok ? firstLine(mcpVersion.stdout) : undefined;
  diagnostics.githubMcpAuthenticated = Boolean(githubToken());
  if (input.githubMcpEnabled && !diagnostics.githubMcpAvailable) {
    validationErrors.push("Official GitHub MCP server is not available in this runtime.");
  }
  if (input.githubMcpEnabled && diagnostics.githubMcpAvailable && !diagnostics.githubMcpAuthenticated) {
    validationErrors.push(
      "GitHub MCP needs a connected dashboard GitHub account, GITHUB_PERSONAL_ACCESS_TOKEN, GH_TOKEN, or GITHUB_TOKEN."
    );
  }

  const sdkResult = await inspectGitHubSdk(input);
  diagnostics.githubSdkConnected = sdkResult.connected;
  diagnostics.githubSdkVersion = sdkResult.version;
  if (!sdkResult.connected) validationErrors.push(sdkResult.message);

  if (!diagnostics.defaultBranchVerified) {
    const branch = await runTool(
      "git",
      ["ls-remote", "--exit-code", "--heads", "origin", defaultBranch],
      input.localPath
    );
    diagnostics.defaultBranchVerified = branch.ok;
    if (!branch.ok) validationErrors.push(`Default branch ${defaultBranch} was not verified on origin.`);
  }

  const status: ProjectConnection["status"] = validationErrors.length
    ? !diagnostics.remoteMatches && !diagnostics.githubConnected
      ? "remote_mismatch"
      : "needs_github_auth"
    : "connected";

  const finalDiagnostics = {
    ...diagnostics,
    status,
    validationErrors
  };
  return {
    ...finalDiagnostics,
    capabilities: buildProjectCapabilities(input, finalDiagnostics)
  };
}

async function runTool(
  command: string,
  args: string[],
  cwd: string
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const result = await execFile(command, args, {
      cwd,
      env: githubAuthEnv(),
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

async function inspectGitHubSdk(
  input: ProjectConnectionInput
): Promise<{ connected: boolean; version: string; message: string }> {
  const token = githubToken();
  try {
    const octokit = new Octokit({
      ...(token ? { auth: token } : {}),
      userAgent: "five-agent-dev-team/0.1.0"
    });
    const { data } = await octokit.rest.repos.get({
      owner: input.repoOwner,
      repo: input.repoName
    });
    const expectedRepo = `${input.repoOwner}/${input.repoName}`.toLowerCase();
    const actualRepo = `${data.owner?.login || ""}/${data.name || ""}`.toLowerCase();
    return {
      connected: actualRepo === expectedRepo,
      version: "@octokit/rest",
      message:
        actualRepo === expectedRepo
          ? "GitHub SDK/Octokit can read repository metadata."
          : `GitHub SDK/Octokit returned ${actualRepo || "an unexpected repository"}.`
    };
  } catch (error) {
    return {
      connected: false,
      version: "@octokit/rest",
      message: token
        ? `GitHub SDK/Octokit could not read ${input.repoOwner}/${input.repoName}: ${error instanceof Error ? error.message : String(error)}`
        : `GitHub SDK/Octokit could not read ${input.repoOwner}/${input.repoName} without a token. Public repos can work unauthenticated; private repos need GH_TOKEN, GITHUB_TOKEN, or GITHUB_PERSONAL_ACCESS_TOKEN.`
    };
  }
}

function buildProjectCapabilities(
  input: ProjectConnectionInput,
  diagnostics: ProjectConnectionDiagnostics
): ProjectCapabilityStatus[] {
  const remoteReady = Boolean(diagnostics.remoteMatches || diagnostics.githubConnected);
  return [
    {
      id: "github-cli",
      label: "GitHub CLI",
      kind: "github_cli",
      enabled: true,
      status: diagnostics.ghAvailable ? (diagnostics.ghAuthed ? "ready" : "needs_auth") : "missing",
      summary: diagnostics.ghAvailable
        ? "gh is installed for deterministic branch, PR, Actions, release, and sync operations."
        : "gh is missing from this runtime.",
      details: [
        diagnostics.githubCliVersion || "",
        diagnostics.ghAuthed ? "authenticated or token-backed" : "authentication required"
      ].filter(Boolean)
    },
    {
      id: "github-mcp",
      label: "GitHub MCP",
      kind: "github_mcp",
      enabled: input.githubMcpEnabled ?? true,
      status: !input.githubMcpEnabled
        ? "disabled"
        : diagnostics.githubMcpAvailable
          ? diagnostics.githubMcpAuthenticated
            ? "ready"
            : "needs_auth"
          : "missing",
      summary:
        "Official GitHub MCP server provides dynamic toolsets for repo, issue, PR, Actions, code security, and release context.",
      details: [
        diagnostics.githubMcpVersion || "",
        "stdio",
        "dynamic toolsets",
        input.githubWriteEnabled ? "write-capable by policy" : "read-only by default"
      ].filter(Boolean)
    },
    {
      id: "github-sdk",
      label: "GitHub SDK",
      kind: "github_sdk",
      enabled: true,
      status: diagnostics.githubSdkConnected ? "ready" : "needs_auth",
      summary: "Octokit powers controller-owned GitHub API coordination and verification.",
      details: [diagnostics.githubSdkVersion || "@octokit/rest"]
    },
    {
      id: "repo-scope",
      label: "Repo Scope",
      kind: "repo",
      enabled: true,
      status: remoteReady && diagnostics.defaultBranchVerified ? "ready" : "error",
      summary: "Local git checkout, origin remote, and default branch are bound to this project.",
      details: [input.localPath, `${input.repoOwner}/${input.repoName}`, `branch ${input.defaultBranch || "main"}`]
    },
    {
      id: "repo-memory",
      label: "Permanent Memory",
      kind: "memory",
      enabled: true,
      status: "ready",
      summary: "Memory, context files, artifacts, and latest-loop lessons are isolated per repository.",
      details: [`namespace ${input.projectId || `${input.repoOwner}-${input.repoName}`.toLowerCase()}`]
    },
    {
      id: "deep-research",
      label: "Deep Research",
      kind: "research",
      enabled: input.webResearchEnabled ?? true,
      status: input.webResearchEnabled ? "available" : "disabled",
      summary:
        "Hosted web search and research MCPs load only for current docs, advisories, ecosystem changes, and hard debugging.",
      details: [
        process.env.TAVILY_API_KEY
          ? "Tavily MCP token configured"
          : "OpenAI hosted web search available in live agent mode"
      ]
    },
    {
      id: "security-release",
      label: "Security & Release",
      kind: "security",
      enabled: true,
      status: "ready",
      summary:
        "Local checks, secret scan, dependency audit, GitHub Actions, rollback, and sync gates remain controller-owned.",
      details: ["cannot be bypassed by MCP tools"]
    }
  ].map((capability) => ProjectCapabilityStatusSchema.parse(capability));
}

async function getGitHubAccountStatus(): Promise<{
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
}> {
  const source = githubTokenSource();
  const clientIdConfigured = Boolean(process.env.GITHUB_OAUTH_CLIENT_ID?.trim());
  if (!source) {
    return {
      connected: false,
      source: "none",
      scopes: [],
      utilities: buildGitHubConnectedUtilities(false, []),
      clientIdConfigured,
      authFile: githubAuthFilePath(),
      message: clientIdConfigured
        ? "Connect GitHub from the dashboard."
        : "Set GITHUB_OAUTH_CLIENT_ID for one-click dashboard connection, or use GH_TOKEN/GITHUB_TOKEN/gh config."
    };
  }

  try {
    const user = await fetchGitHubUser(source.token);
    const storedScopes =
      source.source === "local"
        ? source.auth.scope
            .split(/[,\s]+/)
            .map((scope) => scope.trim())
            .filter(Boolean)
        : [];
    const scopes = storedScopes.length ? storedScopes : user.scopes;
    return {
      connected: true,
      source: source.source,
      sourceName: source.sourceName,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
      scopes,
      utilities: buildGitHubConnectedUtilities(true, scopes),
      clientIdConfigured,
      authFile: source.source === "local" ? githubAuthFilePath() : undefined,
      message:
        source.source === "local"
          ? "Dashboard-managed GitHub account is connected across GitHub CLI, SDK, MCP, Actions, PRs, releases, and repo memory."
          : `GitHub account is connected through ${source.sourceName} across GitHub CLI, SDK, MCP, Actions, PRs, releases, and repo memory.`
    };
  } catch (error) {
    return {
      connected: false,
      source: source.source,
      sourceName: source.sourceName,
      scopes: [],
      utilities: buildGitHubConnectedUtilities(false, []),
      clientIdConfigured,
      authFile: source.source === "local" ? githubAuthFilePath() : undefined,
      message: `GitHub token could not be verified: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

type GitHubConnectedUtility = {
  id: string;
  label: string;
  status: "ready" | "available" | "needs_scope" | "blocked";
  summary: string;
};

function buildGitHubConnectedUtilities(connected: boolean, scopes: string[]): GitHubConnectedUtility[] {
  const definitions: Array<Omit<GitHubConnectedUtility, "status"> & { scopes?: string[] }> = [
    {
      id: "github-sdk",
      label: "GitHub SDK",
      summary: "Octokit API access for repository metadata, issues, PRs, checks, releases, and automation state."
    },
    {
      id: "github-cli",
      label: "GitHub CLI",
      summary: "Token-backed gh commands for deterministic branch, PR, Actions, release, and sync workflows."
    },
    {
      id: "github-mcp",
      label: "GitHub MCP",
      summary: "Official GitHub MCP dynamic toolsets for repo, issue, PR, Actions, Projects, and security context."
    },
    {
      id: "repo-code",
      label: "Repos & code",
      scopes: ["repo", "public_repo"],
      summary: "Repository discovery, file context, branches, commits, tags, and release coordination."
    },
    {
      id: "issues-prs",
      label: "Issues & PRs",
      scopes: ["repo", "public_repo"],
      summary: "Requests, acceptance criteria, comments, labels, reviews, and autonomous pull requests."
    },
    {
      id: "actions-checks",
      label: "Actions & checks",
      scopes: ["repo", "workflow"],
      summary: "Remote CI status, workflow dispatch, release gates, and check evidence."
    },
    {
      id: "projects",
      label: "Projects",
      scopes: ["project", "read:project"],
      summary: "GitHub Projects context through MCP when the account and organization allow it."
    },
    {
      id: "security",
      label: "Security",
      scopes: ["repo", "security_events"],
      summary: "Code scanning, dependency, secret-protection, and security advisory context where permitted."
    },
    {
      id: "copilot-agent",
      label: "Copilot agent",
      scopes: ["repo"],
      summary:
        "Optional GitHub MCP Copilot toolset for tracking or delegating Copilot coding-agent work when available."
    }
  ];

  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    summary: definition.summary,
    status: connected ? scopeStatus(scopes, definition.scopes || []) : "blocked"
  }));
}

function scopeStatus(scopes: string[], requiredScopes: string[]): GitHubConnectedUtility["status"] {
  if (!requiredScopes.length) return "ready";
  if (!scopes.length) return "available";
  const normalized = scopes.map((scope) => scope.toLowerCase());
  return requiredScopes.some((scope) => normalized.includes(scope.toLowerCase())) ? "ready" : "needs_scope";
}

async function fetchGitHubUser(
  token: string
): Promise<{ login: string; name: string | null; avatarUrl?: string; scopes: string[] }> {
  const octokit = new Octokit({
    auth: token,
    userAgent: "five-agent-dev-team/0.1.0"
  });
  const response = await octokit.rest.users.getAuthenticated();
  const scopeHeader = response.headers["x-oauth-scopes"];
  return {
    login: response.data.login,
    name: response.data.name || null,
    avatarUrl: response.data.avatar_url || undefined,
    scopes:
      typeof scopeHeader === "string"
        ? scopeHeader
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean)
        : []
  };
}

function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ""
  );
}

function safeFileSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  );
}

async function requireStrictProjectScope(input: unknown): Promise<StrictProjectScope> {
  const scope = ProjectScopeRequest.parse(input);
  const projects = await store.listProjectConnections();
  const project = projects.find(
    (candidate) => candidate.projectId === scope.projectId && candidate.repo === scope.repo
  );
  if (!project) {
    throw new HttpError(`Connected project was not found for ${scope.projectId}/${scope.repo}.`, 400);
  }
  if (!project.active) {
    throw new HttpError(`Project ${project.repo} is not enabled for additive loop records.`, 400);
  }
  return { projectId: project.projectId, repo: project.repo };
}

async function requireScopeForProjectId(projectId: string): Promise<StrictProjectScope> {
  const projects = await store.listProjectConnections();
  const project = projects.find((candidate) => candidate.projectId === projectId || candidate.id === projectId);
  if (!project) throw new HttpError(`Connected project ${projectId} was not found.`, 404);
  if (!project.active) throw new HttpError(`Project ${project.repo} is not active.`, 400);
  return { projectId: project.projectId, repo: project.repo };
}

async function requireScopeForWorkItem(workItemId: string): Promise<{ scope: StrictProjectScope; workItem: WorkItem }> {
  const workItem = (await store.listWorkItems()).find((item) => item.id === workItemId);
  if (!workItem) throw new HttpError(`Work item ${workItemId} was not found.`, 404);
  if (!workItem.projectId || !workItem.repo) {
    throw new HttpError(`Work item ${workItemId} is not scoped to a connected project.`, 400);
  }
  return {
    scope: await requireStrictProjectScope({ projectId: workItem.projectId, repo: workItem.repo }),
    workItem
  };
}

async function findOpportunityById(id: string): Promise<{ scope: StrictProjectScope; opportunity: Opportunity }> {
  const projects = await store.listProjectConnections();
  for (const project of projects.filter((candidate) => candidate.active)) {
    const scope = { projectId: project.projectId, repo: project.repo };
    const opportunity = (await store.listOpportunities(scope)).find((item) => item.id === id);
    if (opportunity) return { scope, opportunity };
  }
  throw new HttpError(`Opportunity ${id} was not found.`, 404);
}

async function findLatestProposalForWorkItem(scope: StrictProjectScope, workItemId: string): Promise<Proposal | null> {
  const proposals = await store.listProposals(scope);
  return proposals.find((proposal) => proposal.workItemId === workItemId) || null;
}

async function decideProposalById(proposalId: string, input: z.infer<typeof ProposalDecisionRequest>) {
  const scope = await requireStrictProjectScope(input);
  const proposal = (await store.listProposals(scope)).find((item) => item.id === proposalId);
  if (!proposal) throw new HttpError(`Proposal ${proposalId} was not found for ${scope.projectId}.`, 404);
  const updated = await store.decideProposal(scope, proposalId, input);
  let nextState: WorkItem["state"] | undefined;
  let signaled = false;
  if (proposal.workItemId) {
    const workItem = (await store.listWorkItems()).find((item) => item.id === proposal.workItemId);
    if (workItem) {
      nextState = input.decision === "accept" ? "CONTRACT" : input.decision === "revise" ? "RND" : "CLOSED";
      if (workItem.state !== nextState && canTransition(workItem.state, nextState)) {
        await store.updateWorkItemState(workItem.id, nextState);
      }
      signaled = await signalProposalDecision(workItem, {
        decision: input.decision === "accept" ? "accept" : input.decision === "revise" ? "revise" : "reject",
        feedback: input.reason,
        decidedBy: input.decidedBy,
        decidedAt: new Date().toISOString()
      });
      await store.addTeamBusMessage(scope, {
        workItemId: workItem.id,
        loopRunId: proposal.loopRunId,
        from: "product-delivery-orchestrator",
        kind: input.decision === "accept" ? "decision" : input.decision === "revise" ? "handoff" : "blocker",
        topic: `Proposal ${input.decision}`,
        body: input.reason,
        payload: { proposalId, nextState, temporalSignaled: signaled }
      });
    }
  }
  return { proposal: mapProposalForUi(updated), workItemId: proposal.workItemId, nextState, signaled };
}

async function scanLeanOpportunity(
  scope: StrictProjectScope
): Promise<{ opportunity: Opportunity; created: boolean; sources: Array<"human_direction" | "repo_memory"> }> {
  const direction = await store.getDirection(scope);
  const sources: Array<"human_direction" | "repo_memory"> = [direction ? "human_direction" : "repo_memory"];
  const opportunities = await store.listOpportunities(scope);
  const existing =
    opportunities.find((item) => item.id === "autonomous-scan") ||
    opportunities.find(
      (item) => item.status !== "accepted" && item.status !== "rejected" && item.tags.includes("autonomous-scan")
    );
  if (existing) return { opportunity: existing, created: false, sources };

  const title = direction?.summary
    ? `Act on project direction: ${direction.summary.slice(0, 80)}`
    : "Strengthen repo reliability, tests, and release readiness";
  const summary = direction?.summary
    ? `Use the saved project direction as steering input, then prefer hardening, debugging, testing, performance, and maintainability work before proposing feature expansion. Direction: ${direction.summary}`
    : "No user work is blocking, so run a lean autonomous hardening pass: inspect failed checks, TODO/FIXME markers, weak tests, recent blockers, release-gate gaps, and repo memory before proposing the next safest improvement.";
  const opportunity = await store.upsertOpportunity(scope, {
    id: "autonomous-scan",
    title,
    summary,
    source: direction ? "operator" : "agent",
    priority: "medium",
    status: "new",
    tags: ["autonomous-scan", "hardening", "deduped"]
  });
  return { opportunity, created: true, sources };
}

async function decideWorkItemProposal(workItemId: string, decision: "accept" | "revise" | "reject", body: unknown) {
  const { scope, workItem } = await requireScopeForWorkItem(workItemId);
  const proposal = await findLatestProposalForWorkItem(scope, workItem.id);
  if (!proposal) throw new HttpError(`No proposal is attached to ${workItem.id}.`, 404);
  const input = WorkItemProposalDecisionRequest.parse(body);
  const updated = await store.decideProposal(scope, proposal.id, {
    decision,
    decidedBy: "human",
    reason: input.feedback || defaultProposalDecisionReason(decision),
    requestedChanges: input.feedback ? [input.feedback] : []
  });
  const nextState = decision === "accept" ? "CONTRACT" : decision === "revise" ? "RND" : "CLOSED";
  if (workItem.state !== nextState && canTransition(workItem.state, nextState)) {
    await store.updateWorkItemState(workItem.id, nextState);
  }
  await store.addTeamBusMessage(scope, {
    workItemId: workItem.id,
    from: "product-delivery-orchestrator",
    kind: decision === "accept" ? "decision" : decision === "revise" ? "handoff" : "blocker",
    topic: `Proposal ${decision}`,
    body: input.feedback || defaultProposalDecisionReason(decision),
    payload: { proposalId: proposal.id, nextState }
  });
  const signaled = await signalProposalDecision(workItem, {
    decision,
    feedback: input.feedback,
    decidedBy: "human",
    decidedAt: new Date().toISOString()
  });
  return { proposal: mapProposalForUi(updated), workItemId: workItem.id, nextState, signaled };
}

async function startWorkflowIfSafe(
  workItem: WorkItem
): Promise<{ workflowId: string | null; queued: boolean; reason?: string }> {
  const status = await store.getStatus();
  if (status.system.emergencyStop) {
    return {
      workflowId: null,
      queued: true,
      reason: status.system.emergencyReason || "Emergency stop is active"
    };
  }

  if (workItem.projectId && workItem.repo) {
    const activeSameProject = status.workItems.some(
      (item) =>
        item.id !== workItem.id &&
        item.projectId === workItem.projectId &&
        item.repo === workItem.repo &&
        !["NEW", "CLOSED", "BLOCKED"].includes(item.state)
    );
    if (activeSameProject) {
      return {
        workflowId: null,
        queued: true,
        reason: "A same-project loop is already running. This work item will wait until that loop closes or blocks."
      };
    }
  }

  const claimed = await store.claimWorkItemForWorkflow(workItem.id);
  if (!claimed) {
    return { workflowId: null, queued: true, reason: "Work item is already claimed by a workflow." };
  }

  await store.addEvent({
    workItemId: workItem.id,
    stage: "NEW",
    ownerAgent: "product-delivery-orchestrator",
    level: "info",
    type: "workflow_claimed",
    message: `Workflow claimed for ${workItem.title}.`
  });
  try {
    const workflowId = await startAutonomousWorkflow(workItem);
    if (workflowId) {
      await store.updateWorkItemState(workItem.id, "INTAKE");
      if (workItem.projectId && workItem.repo) {
        await store.upsertLoopRun(
          { projectId: workItem.projectId, repo: workItem.repo },
          {
            id: `loop-${workItem.id}`,
            workItemId: workItem.id,
            status: "running",
            summary: `Autonomous loop started for ${workItem.title}.`
          }
        );
      }
    } else {
      await store.releaseWorkItemWorkflowClaim(workItem.id);
    }
    return { workflowId, queued: !workflowId };
  } catch (error) {
    await store.releaseWorkItemWorkflowClaim(workItem.id);
    throw error;
  }
}

function mapDirectionForUi(direction: Direction, alias?: z.infer<typeof DirectionAliasRequest>) {
  const pause = alias?.pauseNewLoopsAfterCurrent ?? direction.constraints.some((item) => /pause new loops/i.test(item));
  const standingDirection =
    alias?.mode === "standing" || /standing/i.test(direction.title) ? direction.summary : undefined;
  const nextLoopDirection =
    alias?.mode !== "standing" && !/standing/i.test(direction.title) ? direction.summary : undefined;
  return {
    ...direction,
    standingDirection,
    nextLoopDirection,
    currentPriority: direction.goals[0],
    focus: direction.summary,
    avoid: direction.constraints.filter((item) => !/pause new loops/i.test(item)),
    pauseNewLoopsAfterCurrent: pause
  };
}

function mapTeamBusMessageForUi(message: StoreTeamBusMessage) {
  return {
    ...message,
    type: message.kind,
    ownerAgent: message.from,
    agent: message.from,
    stage: String(message.payload?.stage || message.topic || ""),
    title: message.topic,
    summary: message.body,
    message: message.body
  };
}

function mapLoopRunForUi(run: LoopRun) {
  return {
    ...run,
    currentStage: run.status,
    startedAt: run.createdAt,
    closureSummary: run.status === "closed" ? run.summary : undefined,
    blockingReason: run.status === "blocked" ? run.summary : undefined,
    nextRecommendedLoop:
      run.status === "closed" ? "Scan for the next highest-value queued work or opportunity." : undefined,
    releaseState: run.status
  };
}

function mapOpportunityForUi(opportunity: Opportunity) {
  return {
    ...opportunity,
    risk: opportunity.priority === "urgent" || opportunity.priority === "high" ? "high" : "medium",
    score:
      opportunity.priority === "urgent"
        ? 95
        : opportunity.priority === "high"
          ? 85
          : opportunity.priority === "medium"
            ? 70
            : 50,
    evidence: opportunity.tags
  };
}

function mapProposalForUi(proposal: Proposal) {
  return {
    ...proposal,
    problem: proposal.summary,
    researchSummary: proposal.researchFindings.join(" ") || proposal.summary,
    recommendedApproach: proposal.recommendation,
    tasks: proposal.implementationPlan,
    validationPlan: proposal.validationPlan.join("; "),
    rollbackPlan:
      proposal.risks.find((risk) => /rollback/i.test(risk)) ||
      "Use the existing release rollback path and block release if rollback cannot be proven.",
    autoAcceptEligible: proposal.status === "accepted"
  };
}

function defaultProposalDecisionReason(decision: "accept" | "revise" | "reject"): string {
  if (decision === "accept") return "Proposal accepted through dashboard steering.";
  if (decision === "revise") return "Proposal changes requested through dashboard steering.";
  return "Proposal rejected through dashboard steering.";
}

app.post("/api/work-items", async (req, res, next) => {
  try {
    const input = CreateWorkItemRequest.parse(req.body);
    await requireConnectedProjectForWork(input);
    const workItem = await store.createWorkItem(input);
    const started = await startWorkflowIfSafe(workItem);
    const workflowId = started.workflowId;
    const responseWorkItem = workflowId
      ? { ...workItem, state: "INTAKE" as const, updatedAt: new Date().toISOString() }
      : workItem;
    res.status(started.queued ? 202 : 201).json({
      workItem: responseWorkItem,
      workflowId,
      queued: started.queued,
      reason: started.reason
    });
  } catch (error) {
    next(error);
  }
});

async function requireConnectedProjectForWork(input: z.infer<typeof CreateWorkItemRequest>): Promise<void> {
  if (/^(1|true|yes)$/i.test(process.env.AGENT_TEAM_ALLOW_DEFAULT_CONFIG || "")) return;
  const projects = await store.listProjectConnections();
  if (!projects.length) {
    throw new HttpError("Connect a target GitHub repository before starting autonomous work.", 400);
  }
  const project =
    input.projectId || input.repo
      ? projects.find(
          (candidate) =>
            (input.projectId ? candidate.projectId === input.projectId : true) &&
            (input.repo ? candidate.repo === input.repo : true)
        )
      : projects.find((candidate) => candidate.active);
  if (!project) {
    throw new HttpError(
      `Connected project was not found for ${input.projectId || input.repo || "the requested work item"}.`,
      400
    );
  }
  if (!project.active) {
    throw new HttpError(`Project ${project.repo} is not enabled for autonomous work.`, 400);
  }
  if (project.status !== "connected") {
    throw new HttpError(
      `Project ${project.repo} is not fully connected: ${project.validationErrors.join("; ") || project.status}.`,
      400
    );
  }
}

app.post("/api/emergency-stop", async (req, res, next) => {
  try {
    const input = EmergencyControlRequestSchema.parse(req.body);
    await store.setEmergencyStop(true, `[${input.scope}] ${input.reason}`);
    res.json({ emergencyStop: true, scope: input.scope, reason: input.reason });
  } catch (error) {
    next(error);
  }
});

app.post("/api/emergency-resume", async (req, res, next) => {
  try {
    const input = EmergencyControlRequestSchema.parse(req.body);
    await store.setEmergencyStop(false);
    res.json({ emergencyStop: false, scope: input.scope, reason: input.reason });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (error instanceof z.ZodError) {
    res.status(400).type("application/problem+json").json({
      type: "https://five-agent-dev-team.local/problems/invalid-request",
      title: "Invalid request",
      status: 400,
      detail: message
    });
    return;
  }
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  res
    .status(statusCode)
    .type("application/problem+json")
    .json({
      type: "https://five-agent-dev-team.local/problems/request-failed",
      title: statusCode >= 500 ? "Internal server error" : "Request failed",
      status: statusCode,
      detail: message
    });
});

store.init().then(() => {
  startSmartScheduler(store);
  app.listen(port, host, () => {
    console.log(`AI Dev Team controller listening on http://${host}:${port}`);
  });
});

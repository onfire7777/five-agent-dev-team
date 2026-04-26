import "dotenv/config";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { createStore } from "./store";
import { checkTemporalConnection, startAutonomousWorkflow } from "./temporal";
import { startSmartScheduler } from "./scheduler";

const CreateWorkItemRequest = z.object({
  title: z.string().min(1),
  requestType: z.enum(["feature", "bug", "performance", "security", "privacy", "refactor", "research"]).default("feature"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dependencies: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
  frontendNeeded: z.boolean().default(true),
  backendNeeded: z.boolean().default(true),
  rndNeeded: z.boolean().default(true)
});

const app = express();
const store = createStore();
const port = Number(process.env.PORT || 4310);

class HttpError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}

app.use(cors());
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
    const after = Number(req.query.after || 0);
    const limit = Math.min(Number(req.query.limit || 50), 100);
    res.json(await store.listEvents(Number.isFinite(after) ? after : 0, Number.isFinite(limit) ? limit : 50));
  } catch (error) {
    next(error);
  }
});

app.get("/api/events/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let lastSequence = Number(req.query.after || 0);
  if (!Number.isFinite(lastSequence)) lastSequence = 0;

  const sendEvents = async () => {
    const events = await store.listEvents(lastSequence, 50);
    for (const event of events) {
      lastSequence = event.sequence;
      res.write(`id: ${event.sequence}\n`);
      res.write(`event: agent-event\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  const timer = setInterval(() => {
    sendEvents().catch((error) => {
      res.write(`event: stream-error\n`);
      res.write(`data: ${JSON.stringify({ error: error instanceof Error ? error.message : "event stream failed" })}\n\n`);
    });
  }, 2000);

  await sendEvents().catch(() => undefined);
  req.on("close", () => clearInterval(timer));
});

app.post("/api/work-items", async (req, res, next) => {
  try {
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

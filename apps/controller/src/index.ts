import "dotenv/config";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { createStore } from "./store";
import { startAutonomousWorkflow } from "./temporal";
import { startSmartScheduler } from "./scheduler";

const CreateWorkItemRequest = z.object({
  title: z.string().min(1),
  requestType: z.enum(["feature", "bug", "performance", "security", "privacy", "refactor", "research"]).default("feature"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  acceptanceCriteria: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
  frontendNeeded: z.boolean().default(true),
  backendNeeded: z.boolean().default(true),
  rndNeeded: z.boolean().default(true)
});

const app = express();
const store = createStore();
const port = Number(process.env.PORT || 4310);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "agent-team-controller" });
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

app.post("/api/work-items", async (req, res, next) => {
  try {
    const input = CreateWorkItemRequest.parse(req.body);
    const workItem = await store.createWorkItem(input);
    const workflowId = await startAutonomousWorkflow(workItem);
    res.status(201).json({ workItem, workflowId });
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
  res.status(400).json({ error: message });
});

store.init().then(() => {
  startSmartScheduler(store);
  app.listen(port, () => {
    console.log(`AI Dev Team controller listening on http://localhost:${port}`);
  });
});

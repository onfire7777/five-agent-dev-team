import { Connection, Client } from "@temporalio/client";
import type { WorkItem } from "../../../packages/shared/src";

export function workflowIdForWorkItem(workItem: WorkItem): string {
  return `wi-${workItem.projectId || "unscoped"}-${workItem.id}`;
}

export async function checkTemporalConnection(): Promise<boolean> {
  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) return true;

  let connection: Connection | null = null;
  const connectionPromise = Connection.connect({ address });
  try {
    connection = await withTimeout(
      connectionPromise,
      positiveTimeoutMs(process.env.TEMPORAL_HEALTH_TIMEOUT_MS, 2000),
      `Temporal connection timed out for ${address}.`
    );
  } catch (error) {
    void connectionPromise.then(
      (lateConnection) => lateConnection.close().catch(() => undefined),
      () => undefined
    );
    throw error;
  } finally {
    await connection?.close().catch(() => undefined);
  }
  return true;
}

export async function startAutonomousWorkflow(workItem: WorkItem): Promise<string | null> {
  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) return null;

  const workflowId = workflowIdForWorkItem(workItem);
  let connection: Connection | null = null;
  try {
    connection = await Connection.connect({ address });
    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || "default"
    });
    await client.workflow.start("autonomousDevelopmentWorkflow", {
      taskQueue: process.env.TEMPORAL_TASK_QUEUE || "agent-team",
      workflowId,
      args: [workItem]
    });
    return workflowId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already started|already exists|workflow execution already/i.test(message)) {
      return workflowId;
    }
    console.warn("Temporal workflow start skipped:", error instanceof Error ? error.message : error);
    return null;
  } finally {
    await connection?.close().catch(() => undefined);
  }
}

export async function signalProposalDecision(
  workItem: WorkItem,
  decision: { decision: "accept" | "revise" | "reject"; feedback?: string; decidedBy?: string; decidedAt?: string }
): Promise<boolean> {
  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) return false;

  let connection: Connection | null = null;
  try {
    connection = await Connection.connect({ address });
    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || "default"
    });
    const handle = client.workflow.getHandle(workflowIdForWorkItem(workItem));
    await handle.signal("proposalDecision", decision);
    return true;
  } catch (error) {
    console.warn("Temporal proposal decision signal skipped:", error instanceof Error ? error.message : error);
    return false;
  } finally {
    await connection?.close().catch(() => undefined);
  }
}

function positiveTimeoutMs(value: string | undefined, fallbackMs: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

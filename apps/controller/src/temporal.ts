import { Client, Connection, WorkflowNotFoundError } from "@temporalio/client";
import type { WorkItem } from "../../../packages/shared/src";

export type TemporalRecoveryAction = "cancel" | "terminate";

export interface TemporalWorkflowRecoveryResult {
  workflowId: string;
  attempted: boolean;
  recovered: boolean;
  action: TemporalRecoveryAction;
  reason: "cancelled" | "terminated" | "not_found" | "temporal_not_configured";
  message: string;
}

export function workflowIdForWorkItem(workItem: WorkItem): string {
  if (!workItem.projectId) {
    throw new Error(`Cannot start Temporal workflow for unscoped work item ${workItem.id}.`);
  }
  return `wi-${workItem.projectId}-${workItem.id}`;
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

  let connection: Connection | null = null;
  try {
    const workflowId = workflowIdForWorkItem(workItem);
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
      return workflowIdForWorkItem(workItem);
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

export async function recoverAutonomousWorkflow(
  workItem: WorkItem,
  options: { action?: TemporalRecoveryAction; reason?: string } = {}
): Promise<TemporalWorkflowRecoveryResult> {
  const workflowId = workItem.projectId ? workflowIdForWorkItem(workItem) : `wi-unscoped-${workItem.id}`;
  const action = options.action || "terminate";
  const recoveryReason = options.reason || `Manual recovery requested for ${workItem.id}.`;
  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) {
    return {
      workflowId,
      attempted: false,
      recovered: false,
      action,
      reason: "temporal_not_configured",
      message: "TEMPORAL_ADDRESS is not configured; local workflow claim recovery can continue."
    };
  }
  if (!workItem.projectId) {
    return {
      workflowId,
      attempted: false,
      recovered: false,
      action,
      reason: "not_found",
      message: `Temporal workflow ${workflowId} cannot be resolved without projectId; local workflow claim recovery can continue.`
    };
  }

  let connection: Connection | null = null;
  try {
    connection = await Connection.connect({ address });
    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || "default"
    });
    const handle = client.workflow.getHandle(workflowId);
    if (action === "cancel") {
      await handle.cancel();
      return {
        workflowId,
        attempted: true,
        recovered: true,
        action,
        reason: "cancelled",
        message: `Temporal workflow ${workflowId} was cancelled.`
      };
    }

    await handle.terminate(recoveryReason);
    return {
      workflowId,
      attempted: true,
      recovered: true,
      action,
      reason: "terminated",
      message: `Temporal workflow ${workflowId} was terminated.`
    };
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) {
      return {
        workflowId,
        attempted: true,
        recovered: false,
        action,
        reason: "not_found",
        message: `Temporal workflow ${workflowId} was not found; local workflow claim recovery can continue.`
      };
    }
    throw error;
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

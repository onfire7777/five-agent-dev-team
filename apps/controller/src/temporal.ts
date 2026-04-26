import { Connection, Client } from "@temporalio/client";
import type { WorkItem } from "../../../packages/shared/src";

export function workflowIdForWorkItem(workItem: WorkItem): string {
  return `agent-team-${workItem.id}`;
}

export async function checkTemporalConnection(): Promise<boolean> {
  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) return true;

  const connection = await Connection.connect({ address });
  await connection.close();
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

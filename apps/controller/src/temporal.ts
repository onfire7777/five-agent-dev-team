import { Connection, Client } from "@temporalio/client";
import type { WorkItem } from "../../../packages/shared/src";

export async function startAutonomousWorkflow(workItem: WorkItem): Promise<string | null> {
  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) return null;

  try {
    const connection = await Connection.connect({ address });
    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || "default"
    });
    const workflowId = `agent-team-${workItem.id}-${Date.now()}`;
    await client.workflow.start("autonomousDevelopmentWorkflow", {
      taskQueue: process.env.TEMPORAL_TASK_QUEUE || "agent-team",
      workflowId,
      args: [workItem]
    });
    return workflowId;
  } catch (error) {
    console.warn("Temporal workflow start skipped:", error instanceof Error ? error.message : error);
    return null;
  }
}


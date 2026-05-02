import { createStore, type ControllerStore } from "../apps/controller/src/store";
import { isTerminalWorkItemState, type AgentEvent, type WorkItem, type WorkItemState } from "../packages/shared/src";
import {
  recoverAutonomousWorkflow,
  type TemporalRecoveryAction,
  type TemporalWorkflowRecoveryResult
} from "../apps/controller/src/temporal";

export interface WorkflowRecoveryResult {
  workItemId: string;
  previousState: WorkItemState;
  currentState: WorkItemState;
  claimReleased: boolean;
  stateChanged: boolean;
  temporal: TemporalWorkflowRecoveryResult;
  event: AgentEvent;
}

export interface RecoverWorkflowOptions {
  workItemId: string;
  reason?: string;
  action?: TemporalRecoveryAction;
  store?: ControllerStore;
  temporalRecover?: (
    workItem: WorkItem,
    options: { action?: TemporalRecoveryAction; reason?: string }
  ) => Promise<TemporalWorkflowRecoveryResult>;
}

export async function recoverWorkflow(options: RecoverWorkflowOptions): Promise<WorkflowRecoveryResult> {
  const store = options.store || createStore();
  await store.init();

  const record = await store.getWorkItemWithArtifacts(options.workItemId);
  if (!record) throw new Error(`Work item ${options.workItemId} was not found.`);

  const reason = options.reason || `Workflow recovery requested for ${record.workItem.id}.`;
  const temporal = await (options.temporalRecover || recoverAutonomousWorkflow)(record.workItem, {
    action: options.action,
    reason
  });
  await store.releaseWorkItemWorkflowClaim(record.workItem.id);

  let currentState = record.workItem.state;
  let stateChanged = false;
  if (!isTerminalWorkItemState(record.workItem.state)) {
    await store.updateWorkItemState(record.workItem.id, "BLOCKED");
    currentState = "BLOCKED";
    stateChanged = true;
  }

  const event = await store.addEvent({
    workItemId: record.workItem.id,
    stage: currentState,
    level: stateChanged ? "warn" : "info",
    type: "system",
    message: [
      `Workflow recovery completed for ${record.workItem.id}.`,
      `Temporal result: ${temporal.reason}.`,
      stateChanged ? "Work item moved to BLOCKED for operator review." : "Work item was already terminal."
    ].join(" ")
  });

  return {
    workItemId: record.workItem.id,
    previousState: record.workItem.state,
    currentState,
    claimReleased: true,
    stateChanged,
    temporal,
    event
  };
}

if (require.main === module) {
  const workItemId = argValue("--work-item") || argValue("--workItem") || process.argv[2];
  if (!workItemId || workItemId.startsWith("--")) {
    console.error(
      "Usage: npm run recover:workflow -- --work-item <WORK_ITEM_ID> [--action cancel|terminate] [--reason text]"
    );
    process.exit(1);
  }

  let action: TemporalRecoveryAction | undefined;
  try {
    action = parseAction(argValue("--action"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  recoverWorkflow({
    workItemId,
    action,
    reason: argValue("--reason")
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}

function parseAction(value: string | undefined): TemporalRecoveryAction | undefined {
  if (!value) return undefined;
  if (value === "cancel" || value === "terminate") return value;
  throw new Error(`Unsupported recovery action ${value}. Use cancel or terminate.`);
}

function argValue(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

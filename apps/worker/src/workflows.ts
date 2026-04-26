import { proxyActivities } from "@temporalio/workflow";
import type { WorkItem } from "../../../packages/shared/src";
import type * as activities from "./activities";

const activity = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 3
  }
});

export async function autonomousDevelopmentWorkflow(workItem: WorkItem) {
  await activity.ensureNotStopped(workItem.id);

  const intake = await activity.runAgentStage({ workItem, stage: "INTAKE", previousArtifacts: [] });

  const [rnd, earlyVerificationPlan] = await Promise.all([
    workItem.rndNeeded
      ? activity.runAgentStage({ workItem, stage: "RND", previousArtifacts: [intake] })
      : Promise.resolve(null),
    activity.runAgentStage({ workItem, stage: "VERIFY", previousArtifacts: [intake] })
  ]);

  const contract = await activity.runAgentStage({
    workItem,
    stage: "CONTRACT",
    previousArtifacts: [intake, rnd, earlyVerificationPlan].filter(Boolean) as any
  });

  await activity.prepareBuildBranches(workItem);

  const builders = await Promise.all([
    workItem.frontendNeeded
      ? activity.runAgentStage({ workItem, stage: "FRONTEND_BUILD", previousArtifacts: [intake, contract] })
      : Promise.resolve(null),
    workItem.backendNeeded
      ? activity.runAgentStage({ workItem, stage: "BACKEND_BUILD", previousArtifacts: [intake, contract] })
      : Promise.resolve(null)
  ]);

  const buildArtifacts = builders.filter(Boolean) as any;
  const integration = await activity.integrateBranches(workItem, [contract, ...buildArtifacts]);
  const verify = await activity.runVerification(workItem, [integration, ...buildArtifacts]);
  const release = await activity.performAutonomousRelease(workItem, [verify]);
  const closed = await activity.runAgentStage({ workItem, stage: "CLOSED", previousArtifacts: [release] });

  return {
    workItemId: workItem.id,
    status: "closed",
    artifacts: [intake, rnd, contract, ...buildArtifacts, integration, verify, release, closed].filter(Boolean)
  };
}

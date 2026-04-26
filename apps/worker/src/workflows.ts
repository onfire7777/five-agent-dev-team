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
  await activity.ensureNotStopped(workItem.id);

  const [rnd, earlyVerificationPlan] = await Promise.all([
    workItem.rndNeeded
      ? activity.runAgentStage({ workItem, stage: "RND", previousArtifacts: [intake] })
      : Promise.resolve(null),
    activity.planVerification(workItem, [intake])
  ]);
  await activity.ensureNotStopped(workItem.id);

  const contract = await activity.runAgentStage({
    workItem,
    stage: "CONTRACT",
    previousArtifacts: [intake, rnd, earlyVerificationPlan].filter(Boolean) as any
  });

  await activity.prepareBuildBranches(workItem);
  await activity.ensureNotStopped(workItem.id);

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
  if (verify.status !== "passed" || verify.nextStage === "BLOCKED") {
    const blocked = await activity.runAgentStage({ workItem, stage: "BLOCKED", previousArtifacts: [verify] });
    return {
      workItemId: workItem.id,
      status: "blocked",
      artifacts: [intake, rnd, contract, ...buildArtifacts, integration, verify, blocked].filter(Boolean)
    };
  }

  const release = await activity.performAutonomousRelease(workItem, [verify]);
  if (release.status !== "passed" || release.nextStage === "BLOCKED") {
    const blocked = await activity.runAgentStage({ workItem, stage: "BLOCKED", previousArtifacts: [release] });
    return {
      workItemId: workItem.id,
      status: "blocked",
      artifacts: [intake, rnd, contract, ...buildArtifacts, integration, verify, release, blocked].filter(Boolean)
    };
  }

  const closed = await activity.runAgentStage({ workItem, stage: "CLOSED", previousArtifacts: [release] });

  return {
    workItemId: workItem.id,
    status: "closed",
    artifacts: [intake, rnd, contract, ...buildArtifacts, integration, verify, release, closed].filter(Boolean)
  };
}

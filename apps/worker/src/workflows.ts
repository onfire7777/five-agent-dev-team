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
  try {
    await activity.ensureNotStopped(workItem.id);

    const loopStart = await activity.recordLoopStart(workItem);
    if (loopStart.status !== "passed" || loopStart.nextStage === "BLOCKED") {
      const closure = await activity.closeWorkLoop(workItem, [loopStart]);
      return {
        workItemId: workItem.id,
        status: "blocked",
        artifacts: [loopStart, closure]
      };
    }

    const intake = await activity.runAgentStage({ workItem, stage: "INTAKE", previousArtifacts: [loopStart] });
    await activity.ensureNotStopped(workItem.id);

    const [rnd, earlyVerificationPlan] = await Promise.all([
      workItem.rndNeeded
        ? activity.runAgentStage({ workItem, stage: "RND", previousArtifacts: [loopStart, intake] })
        : Promise.resolve(null),
      activity.planVerification(workItem, [loopStart, intake])
    ]);
    await activity.ensureNotStopped(workItem.id);

    const proposal = workItem.rndNeeded
      ? await activity.runAgentStage({
          workItem,
          stage: "PROPOSAL",
          previousArtifacts: [loopStart, intake, rnd, earlyVerificationPlan].filter(Boolean) as any
        })
      : null;
    await activity.ensureNotStopped(workItem.id);

    const contractProposal = await activity.runAgentProposal({
      workItem,
      stage: "CONTRACT",
      previousArtifacts: [loopStart, intake, rnd, earlyVerificationPlan, proposal].filter(Boolean) as any
    });

    const contract = await activity.runAgentStage({
      workItem,
      stage: "CONTRACT",
      previousArtifacts: [loopStart, intake, rnd, earlyVerificationPlan, proposal, contractProposal].filter(Boolean) as any
    });

    await activity.prepareBuildBranches(workItem);
    await activity.ensureNotStopped(workItem.id);

    const buildProposals = await Promise.all([
      workItem.frontendNeeded
        ? activity.runAgentProposal({ workItem, stage: "FRONTEND_BUILD", previousArtifacts: [intake, contract] })
        : Promise.resolve(null),
      workItem.backendNeeded
        ? activity.runAgentProposal({ workItem, stage: "BACKEND_BUILD", previousArtifacts: [intake, contract] })
        : Promise.resolve(null)
    ]);

    const proposalArtifacts = buildProposals.filter(Boolean) as any;
    const planningArtifacts = [contractProposal, ...proposalArtifacts].filter(Boolean) as any;
    const builders = await Promise.all([
      workItem.frontendNeeded
        ? activity.runAgentStage({ workItem, stage: "FRONTEND_BUILD", previousArtifacts: [intake, contract, ...proposalArtifacts] })
        : Promise.resolve(null),
      workItem.backendNeeded
        ? activity.runAgentStage({ workItem, stage: "BACKEND_BUILD", previousArtifacts: [intake, contract, ...proposalArtifacts] })
        : Promise.resolve(null)
    ]);

    const buildArtifacts = builders.filter(Boolean) as any;
    const integration = await activity.integrateBranches(workItem, [contract, ...planningArtifacts, ...buildArtifacts]);
    const verify = await activity.runVerification(workItem, [integration, ...buildArtifacts]);
    if (verify.status !== "passed" || verify.nextStage === "BLOCKED") {
      const blocked = await activity.runAgentStage({ workItem, stage: "BLOCKED", previousArtifacts: [verify] });
      const closure = await activity.closeWorkLoop(workItem, [loopStart, intake, rnd, proposal, contract, ...planningArtifacts, ...buildArtifacts, integration, verify, blocked].filter(Boolean) as any);
      return {
        workItemId: workItem.id,
        status: "blocked",
        artifacts: [loopStart, intake, rnd, proposal, contract, ...planningArtifacts, ...buildArtifacts, integration, verify, blocked, closure].filter(Boolean)
      };
    }

    const release = await activity.performAutonomousRelease(workItem, [verify]);
    if (release.status !== "passed" || release.nextStage === "BLOCKED") {
      const blocked = await activity.runAgentStage({ workItem, stage: "BLOCKED", previousArtifacts: [release] });
      const closure = await activity.closeWorkLoop(workItem, [loopStart, intake, rnd, proposal, contract, ...planningArtifacts, ...buildArtifacts, integration, verify, release, blocked].filter(Boolean) as any);
      return {
        workItemId: workItem.id,
        status: "blocked",
        artifacts: [loopStart, intake, rnd, proposal, contract, ...planningArtifacts, ...buildArtifacts, integration, verify, release, blocked, closure].filter(Boolean)
      };
    }

    const closed = await activity.closeWorkLoop(workItem, [loopStart, intake, rnd, proposal, contract, ...planningArtifacts, ...buildArtifacts, integration, verify, release].filter(Boolean) as any);
    if (closed.status !== "passed" || closed.nextStage === "BLOCKED") {
      return {
        workItemId: workItem.id,
        status: "blocked",
        artifacts: [loopStart, intake, rnd, proposal, contract, ...planningArtifacts, ...buildArtifacts, integration, verify, release, closed].filter(Boolean)
      };
    }

    return {
      workItemId: workItem.id,
      status: "closed",
      artifacts: [loopStart, intake, rnd, proposal, contract, ...planningArtifacts, ...buildArtifacts, integration, verify, release, closed].filter(Boolean)
    };
  } finally {
    await activity.releaseWorkflowClaim(workItem.id);
  }
}

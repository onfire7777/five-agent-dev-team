import { condition, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import type { StageArtifact, WorkItem } from "../../../packages/shared/src";
import type * as activities from "./activities";

type ProposalDecisionSignal = {
  decision: "accept" | "revise" | "reject";
  feedback?: string;
  decidedBy?: string;
  decidedAt?: string;
};

export const proposalDecisionSignal = defineSignal<[ProposalDecisionSignal]>("proposalDecision");

const activity = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 3
  }
});

const releaseActivity = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: {
    maximumAttempts: 1
  }
});

export async function autonomousDevelopmentWorkflow(workItem: WorkItem) {
  let proposalDecision: ProposalDecisionSignal | null = null;
  setHandler(proposalDecisionSignal, (decision) => {
    proposalDecision = decision;
  });

  try {
    const artifacts: StageArtifact[] = [];
    const append = (...items: Array<StageArtifact | null | undefined>) => {
      artifacts.push(...(items.filter(Boolean) as StageArtifact[]));
    };
    const blockAndClose = async () => {
      const blocker = artifacts[artifacts.length - 1];
      if (blocker?.stage !== "BLOCKED") {
        append(
          await activity.runAgentStage({ workItem, stage: "BLOCKED", previousArtifacts: blocker ? [blocker] : [] })
        );
      }
      const closure = await activity.closeWorkLoop(workItem, artifacts);
      return {
        workItemId: workItem.id,
        status: "blocked",
        artifacts: [...artifacts, closure]
      };
    };

    await activity.ensureNotStopped(workItem.id);

    const loopStart = await activity.recordLoopStart(workItem);
    append(loopStart);
    if (isBlockingArtifact(loopStart)) return blockAndClose();

    const intake = await activity.runAgentStage({ workItem, stage: "INTAKE", previousArtifacts: artifacts });
    append(intake);
    if (isBlockingArtifact(intake)) return blockAndClose();
    await activity.ensureNotStopped(workItem.id);

    const [rnd, earlyVerificationPlan] = await Promise.all([
      workItem.rndNeeded
        ? activity.runAgentStage({ workItem, stage: "RND", previousArtifacts: artifacts })
        : Promise.resolve(null),
      activity.planVerification(workItem, artifacts)
    ]);
    append(rnd, earlyVerificationPlan);
    if (isBlockingArtifact(rnd)) return blockAndClose();
    await activity.ensureNotStopped(workItem.id);

    if (workItem.rndNeeded) {
      let proposalAttempts = 0;
      let proposalAccepted = false;
      while (!proposalAccepted) {
        proposalAttempts += 1;
        const proposal = await activity.runAgentStage({
          workItem,
          stage: "PROPOSAL",
          previousArtifacts: artifacts
        });
        append(proposal);
        if (isBlockingArtifact(proposal)) return blockAndClose();
        await activity.ensureNotStopped(workItem.id);

        const proposalGate = await activity.evaluateProposalGate({
          workItem,
          proposal,
          previousArtifacts: artifacts
        });
        append(proposalGate);
        if (isBlockingArtifact(proposalGate)) return blockAndClose();
        if (proposalGate.stage === "AWAITING_ACCEPTANCE" && proposalGate.status === "pending") {
          proposalDecision = null;
          await condition(() => proposalDecision !== null);
          const proposalDecisionArtifact = await activity.recordProposalDecision({
            workItem,
            decision: proposalDecision!.decision,
            feedback: proposalDecision!.feedback,
            decidedBy: proposalDecision!.decidedBy,
            decidedAt: proposalDecision!.decidedAt,
            previousArtifacts: artifacts
          });
          append(proposalDecisionArtifact);
          if (isBlockingArtifact(proposalDecisionArtifact)) return blockAndClose();
          if (proposalDecisionArtifact.nextStage === "RND") {
            proposalDecision = null;
            if (proposalAttempts >= 3) {
              append(
                await activity.runAgentStage({
                  workItem,
                  stage: "BLOCKED",
                  previousArtifacts: [proposalDecisionArtifact]
                })
              );
              return blockAndClose();
            }
            const revisedRnd = await activity.runAgentStage({
              workItem,
              stage: "RND",
              previousArtifacts: artifacts
            });
            append(revisedRnd);
            if (isBlockingArtifact(revisedRnd)) return blockAndClose();
            await activity.ensureNotStopped(workItem.id);
            continue;
          }
        }
        proposalAccepted = true;
      }
    }

    const contractProposal = await activity.runAgentProposal({
      workItem,
      stage: "CONTRACT",
      previousArtifacts: artifacts
    });
    append(contractProposal);
    if (isBlockingArtifact(contractProposal)) return blockAndClose();

    const contract = await activity.runAgentStage({
      workItem,
      stage: "CONTRACT",
      previousArtifacts: artifacts
    });
    append(contract);
    if (isBlockingArtifact(contract)) return blockAndClose();

    await activity.prepareBuildBranches(workItem);
    await activity.ensureNotStopped(workItem.id);

    const buildProposals = await Promise.all([
      workItem.frontendNeeded
        ? activity.runAgentProposal({ workItem, stage: "FRONTEND_BUILD", previousArtifacts: artifacts })
        : Promise.resolve(null),
      workItem.backendNeeded
        ? activity.runAgentProposal({ workItem, stage: "BACKEND_BUILD", previousArtifacts: artifacts })
        : Promise.resolve(null)
    ]);

    const proposalArtifacts = buildProposals.filter(Boolean) as StageArtifact[];
    append(...proposalArtifacts);
    if (proposalArtifacts.some(isBlockingArtifact)) return blockAndClose();

    const builders = await Promise.all([
      workItem.frontendNeeded
        ? activity.runAgentStage({ workItem, stage: "FRONTEND_BUILD", previousArtifacts: artifacts })
        : Promise.resolve(null),
      workItem.backendNeeded
        ? activity.runAgentStage({ workItem, stage: "BACKEND_BUILD", previousArtifacts: artifacts })
        : Promise.resolve(null)
    ]);

    const buildArtifacts = builders.filter(Boolean) as StageArtifact[];
    append(...buildArtifacts);
    if (buildArtifacts.some(isBlockingArtifact)) return blockAndClose();

    const integration = await activity.integrateBranches(workItem, artifacts);
    append(integration);
    if (isBlockingArtifact(integration)) return blockAndClose();

    const verify = await activity.runVerification(workItem, [integration, ...buildArtifacts]);
    append(verify);
    if (isBlockingArtifact(verify)) return blockAndClose();

    const release = await releaseActivity.performAutonomousRelease(workItem, [verify]);
    append(release);
    if (isBlockingArtifact(release)) return blockAndClose();

    const closed = await activity.closeWorkLoop(workItem, artifacts);
    append(closed);
    if (isBlockingArtifact(closed)) {
      return {
        workItemId: workItem.id,
        status: "blocked",
        artifacts
      };
    }

    return {
      workItemId: workItem.id,
      status: "closed",
      artifacts
    };
  } finally {
    await activity.releaseWorkflowClaim(workItem.id);
  }
}

function isBlockingArtifact(artifact: StageArtifact | null | undefined): boolean {
  return Boolean(
    artifact && (artifact.status === "blocked" || artifact.status === "failed" || artifact.nextStage === "BLOCKED")
  );
}

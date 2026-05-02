import type { ReleaseDecision, ReleaseClass, TargetRepoConfig, VerificationSignal } from "./schemas";

export function evaluateReleasePolicy(config: TargetRepoConfig, signal: VerificationSignal): ReleaseDecision {
  const requiredFixes: string[] = [];
  const reasons: string[] = [];

  const riskMode = config.release.allowedRisk[signal.riskLevel];
  const requireEveryAutomatedGate = riskMode === "autonomous_with_all_gates";
  const releaseClass: ReleaseClass = signal.releaseClass || "code";

  if (signal.emergencyStopActive) requiredFixes.push("Emergency stop is active.");
  if (!config.release.allowedClasses.includes(releaseClass)) {
    requiredFixes.push(`Release class ${releaseClass} is not allowed by this repo release policy.`);
  } else if (!config.release.autonomousClasses.includes(releaseClass)) {
    requiredFixes.push(`Release class ${releaseClass} is configured for manual release only.`);
  } else {
    reasons.push(`Release class ${releaseClass} is configured for autonomous release.`);
  }
  if (!signal.localChecksPassed) requiredFixes.push("Local checks have not passed.");
  if ((config.release.githubActionsRequired || requireEveryAutomatedGate) && !signal.githubActionsPassed) {
    requiredFixes.push("Required GitHub Actions checks have not passed.");
  }
  if ((config.release.requireCleanWorktree || requireEveryAutomatedGate) && !signal.cleanWorktree) {
    requiredFixes.push("Target repository worktree is not clean.");
  }
  if ((config.release.requireLocalRemoteSync || requireEveryAutomatedGate) && !signal.localRemoteSynced) {
    requiredFixes.push("Local and remote branches are not synchronized.");
  }
  if (!signal.secretScanPassed) requiredFixes.push("Secret scan failed.");
  if (!signal.rollbackPlanPresent) requiredFixes.push("Rollback plan is missing.");
  if (!signal.releaseProofPresent) requiredFixes.push("Release proof is missing.");

  if (riskMode === "manual") {
    requiredFixes.push(`Risk level ${signal.riskLevel} is configured for manual release only.`);
  }
  if (riskMode === "autonomous_with_all_gates") {
    reasons.push(`Risk level ${signal.riskLevel} requires every automated gate to pass.`);
  }

  const allowed = requiredFixes.length === 0;
  if (allowed) {
    reasons.push("All configured autonomous release gates passed.");
  }

  return {
    allowed,
    recommendation: allowed ? "go" : "no_go",
    reasons,
    requiredFixes
  };
}

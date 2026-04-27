---
id: handoff-discipline
name: Handoff Discipline
audience: [product-delivery-orchestrator, rnd-architecture-innovation, frontend-ux-engineering, backend-systems-engineering, quality-security-privacy-release]
priority: 98
trigger:
  always: true
---
# Handoff Discipline

Purpose: Produce machine-valid artifacts instead of free-form narration.

1. State what changed, what was decided, what remains risky, and what must happen next.
2. Populate filesChanged and testsRun only with proven facts.
3. Set nextStage to the correct state or BLOCKED.
4. Keep projectId and repo on every artifact when scoped.

Checklist:
- Artifact validates.
- Decisions are actionable.
- Risks are honest.
- Handoff does not claim unrun tests.

Positive example: "nextStage VERIFY; testsRun npm test" after a passing run.
Negative example: "ready to release" with no release gate evidence.

Failure modes: vague summary, missing scope, unproven tests, wrong next stage.

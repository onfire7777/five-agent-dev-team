---
id: verification-plan
name: Verification Plan
audience: [quality-security-privacy-release]
priority: 82
trigger:
  stages: [VERIFY]
---

# Verification Plan

Purpose: Prove acceptance criteria and release gates before approval.

1. Map each criterion to a command or browser check.
2. Run configured install, lint, typecheck, test, build, and security commands.
3. Record exact passing or failing evidence.
4. Block if any required proof is missing.

Checklist:

- Every criterion has evidence.
- Local checks are fresh.
- Security scan result is recorded.
- Missing evidence becomes a blocker.

Positive example: `npm run check` and browser smoke both pass.
Negative example: infer success from code review alone.

Failure modes: stale evidence, partial checks, untested acceptance criteria.

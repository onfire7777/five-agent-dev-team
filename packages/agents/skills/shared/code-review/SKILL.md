---
id: code-review
name: Code Review
audience:
  [
    product-delivery-orchestrator,
    rnd-architecture-innovation,
    frontend-ux-engineering,
    backend-systems-engineering,
    quality-security-privacy-release
  ]
priority: 85
trigger:
  stages: [VERIFY, RELEASE, BLOCKED]
  keywords: [review, diff, pr, quality]
---

# Code Review

Purpose: Review changed behavior before release decisions.

1. Read the diff, not only the final files.
2. Look for regressions, missing tests, security issues, and broken contracts.
3. Rank findings by impact.
4. Require verification evidence for fixes.

Checklist:

- Findings cite exact files.
- Tests cover changed behavior.
- No release claim lacks evidence.
- Residual risk is named.

Positive example: block release for a missing project scope check.
Negative example: approve because the code "looks clean" without tests.

Failure modes: style-only review, missed contract break, accepting unverified fixes.

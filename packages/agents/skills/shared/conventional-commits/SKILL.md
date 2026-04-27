---
id: conventional-commits
name: Conventional Commits
audience: [product-delivery-orchestrator, rnd-architecture-innovation, frontend-ux-engineering, backend-systems-engineering, quality-security-privacy-release]
priority: 80
trigger:
  keywords: [commit, release, branch, pr]
---
# Conventional Commits

Purpose: Format commits so release and review automation can reason about changes.

1. Choose one type: feat, fix, docs, test, refactor, chore, ci, build.
2. Add a short scope when useful.
3. Use imperative subject, 72 characters or less when practical.
4. Put evidence and breaking changes in the body.

Checklist:
- Type is valid.
- Subject names the change.
- Body includes verification when needed.
- No unrelated changes are hidden.

Positive example: `feat(agent): record prompt provenance on artifacts`.
Negative example: `updates`.

Failure modes: vague subjects, mixed unrelated work, missing breaking-change notes.

---
name: merge-queue-or-shadow-branch
description: Prefer GitHub merge queue; otherwise test-merge through integration/codex before merging.
---

# Merge Queue Or Shadow Branch

Order:

1. Use GitHub merge queue when enabled and practical.
2. Otherwise reset `integration/codex` to `origin/main`.
3. Merge the candidate head into `integration/codex`.
4. Run Captain verification.
5. Merge the original PR only with expected head SHA match.

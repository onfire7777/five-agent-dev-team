---
name: captain-merge-gate
description: Enforce Captain-only merge criteria before any integration action.
---

# Captain Merge Gate

Captain may merge only when:

- PR has `codex-status:ready-to-merge`.
- PR is not draft.
- Latest CI is green on the expected head SHA.
- Required reviews and conversations are resolved.
- No active conflicting claims exist.
- Full Captain verification passes.

If any gate fails, route the blocker and do not merge.

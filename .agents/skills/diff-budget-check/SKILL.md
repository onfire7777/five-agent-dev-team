---
name: diff-budget-check
description: Keep automation patches small enough to review and integrate safely.
---

# Diff Budget Check

Run `npm run diff:budget` before pushing a mutating stage result.

Default limits per mutating run:

- 8-12 files touched.
- 500-800 net line delta.
- 0 new dependencies unless Security/DevOps approves.
- 1 new public API unless Backend/Core owns it and the RFC permits it.

The script reads exact defaults from `C:\Users\burni\.codex\state\five-agent-dev-team-control.json`.
If the budget is exceeded, stop, write a split plan, and do not push the broad accidental change.

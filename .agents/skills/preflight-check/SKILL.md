---
name: preflight-check
description: Verify pause, lock, claims, git cleanliness, branch sync, and duplicate scope before any automation mutates files.
---

# Preflight Check

Run before every stage.

1. Run `node scripts/preflight.mjs --stage=<stage>`.
2. Read `C:\Users\burni\.codex\state\five-agent-dev-team-control.json`.
3. Read `C:\Users\burni\.codex\state\five-agent-dev-team-queue.json`.
4. Stop on pause, active integration lock, expired claim, dirty tree, stale branch, or duplicate active scope.
5. If stopped, write a no-op receipt and compact handoff.

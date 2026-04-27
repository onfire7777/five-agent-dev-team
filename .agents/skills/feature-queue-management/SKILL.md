---
name: feature-queue-management
description: Maintain the approved blocker and feature queue without duplicate scope.
---

# Feature Queue Management

- Treat `C:\Users\burni\.codex\state\five-agent-dev-team-queue.json` as the work source of truth.
- Queue only RFC-backed features scoring at least 22/30.
- Keep one active blocker and at most one active feature.
- Do not queue implementation that overlaps active PR scope.
- Preserve clear owner stage, blocked-by entries, must-not-touch globs, and rollback notes.

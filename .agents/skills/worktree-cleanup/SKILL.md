---
name: worktree-cleanup
description: Safely clean stale local worktrees and reports without deleting active work.
---

# Worktree Cleanup

Use `node scripts/janitor.mjs` for dry-run reporting.

Only use `--apply` when:

- the worktree is clean
- it is stale
- its branch has no open PR
- it is under the Codex worktree directory

Never delete dirty worktrees or protected state/spec files.

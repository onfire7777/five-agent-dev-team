# five-agent-dev-team operating rules

## Primary rule

Optimize for safe convergence, not constant mutation.

## Authority

- R&D may create RFCs, architecture contracts, scores, and queue entries only.
- Stages 1-5 work only in worktrees and PR branches.
- Captain alone may merge, push `main`, update final state, or mark acceptance
  complete.
- Janitor may clean only safe operational artifacts.

## Preflight

- Check `C:\Users\burni\.codex\state\five-agent-dev-team-control.json`.
- Check active claims and integration lock.
- Run `git status --short`.
- Run `git fetch --all --prune`.
- Confirm branch sync before mutation.
- Confirm no duplicate active PR scope.

## Verification

- Run targeted checks after small changes.
- Run full PR readiness checks before `codex-status:ready-to-merge`.
- Captain runs merge queue or `integration/codex` verification before merge.

## Safety

- Never print secrets, tokens, passwords, or resolved private environment values.
- Never run interpolating Docker Compose config into logs.
- Do not add production dependencies without Security/DevOps review.
- Do not document speculative behavior as complete.
- Prefer a no-op receipt over speculative mutation.

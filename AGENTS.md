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

## Codex Cloud GitHub Actions

- In `.github/workflows/codex-cloud-*`, GitHub issues, labels, and workflow
  context are the control plane. Do not block only because local Windows Codex
  state files under `C:\Users\burni\.codex` are unavailable in the cloud runner.
- In Codex Cloud build stages, the workflow gate has already claimed the target
  issue with GitHub labels. Respect that claim and write a clear blocked reason
  only when the target scope is truly outside the assigned lane or verification
  cannot run.
- Resolve lanes in this order: explicit `Lane assignment:` in the issue body,
  then `lane:*` labels, then workflow claim metadata. If no lane can be
  resolved, block with `no lane assignment` instead of falling back to broad
  keyword heuristics.
- The checked-out GitHub Actions workspace is the branch-sync source. If
  `git fetch --all --prune` cannot update `.git/FETCH_HEAD` inside the Codex
  sandbox, do not treat that alone as a blocker. Instead, verify that
  `git rev-parse HEAD` matches the expected commit SHA or that the required PR
  refs exist for lane verification. If those minimal refs are missing, treat the
  run as blocked.

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

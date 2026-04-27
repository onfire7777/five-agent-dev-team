# Repository Operating Rules

## Non-negotiable gates

- Never push directly to `main` except from the Captain Integrator.
- Never print secrets, tokens, passwords, or resolved private environment values.
- Never run `docker compose config` without `--no-interpolate` unless the output
  is intentionally safe and will not be pasted into logs or state.
- Always run `npm ci` before validation after dependency changes.
- Always run `npm run check` before handoff.
- Do not create duplicate branches for active PR scope.

## Specialization

- Backend/core owns controller APIs, workers, shared schemas, state, GitHub
  integration boundaries, and backend tests.
- Frontend/UX owns dashboard behavior, accessibility, responsive layout, and
  browser/E2E smoke coverage.
- Quality/debug owns reproduction, regression tests, coverage gaps, flaky tests,
  and acceptance verification.
- Security/devops owns CI, Gitleaks, audit policy, Docker, release hygiene,
  secret handling, and workflow permissions.
- Docs/alignment owns README, docs, runbooks, acceptance evidence, and spec
  traceability.

## PR policy

- Every material change must go through a PR unless the Captain is doing a
  narrow integration-only repair.
- PRs must include summary, validation, risk, rollback, and acceptance evidence.
- Draft PRs are never mergeable.
- Broad PRs must be reviewed before readiness.
- Use deterministic branch names under `codex/stage-XX-<lane>/<task-slug>`.

## State policy

- Update swarm state compactly.
- Append detailed run facts to the ledger.
- Do not paste full logs into state.
- Prefer a precise no-op handoff over speculative edits.

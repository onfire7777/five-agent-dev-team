# Target Repository Setup

v1 manages one target repo. Add an `agent-team.config.yaml` in this controller repo, then add the workflow template in `templates/target-repo/.github/workflows/agent-release.yml` to the target repository.

## Required Commands

The target repo config must define:

- `install`
- `lint`
- `typecheck`
- `test`
- `build`
- `security`
- `release`

The controller runs configured commands exactly as provided.

Work items can declare `dependencies` as work-item IDs. The scheduler will not start a dependent item until every dependency is `CLOSED`, which keeps parallel execution efficient without unsafe ordering.

## Lean Context Packs

For permanent repo context without UI bloat, add focused markdown or text files under:

```text
.agent-team/context/
```

Good files are small and concrete:

- `TEAM_RULES.md`: package manager, branch rules, command conventions
- `ARCHITECTURE.md`: stable architecture decisions and boundaries
- `GOTCHAS.md`: recurring failures, migration traps, release risks

The controller loads these into agent prompts as repo-scoped permanent memory. Keep this directory curated; do not dump full docs or generated logs into it. You can also list explicit context files in `agent-team.config.yaml` under `context.files`.

## GitHub Permissions

Prefer a GitHub App or fine-scoped token with the minimum required permissions:

- issues: read/write
- pull requests: read/write
- contents: read/write
- checks/actions: read
- workflows: write only if dispatching release workflows

## Autonomous Release

Protected branches and required checks should remain enabled. The autonomous controller coordinates release, but GitHub Actions remains the remote release gate.

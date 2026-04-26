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

## GitHub Permissions

Prefer a GitHub App or fine-scoped token with the minimum required permissions:

- issues: read/write
- pull requests: read/write
- contents: read/write
- checks/actions: read
- workflows: write only if dispatching release workflows

## Autonomous Release

Protected branches and required checks should remain enabled. The autonomous controller coordinates release, but GitHub Actions remains the remote release gate.

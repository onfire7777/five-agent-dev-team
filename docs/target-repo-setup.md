# Target Repository Setup

v1 manages one target repo. Add an `agent-team.config.yaml` in this controller repo, then add the workflow template in `templates/target-repo/.github/workflows/agent-release.yml` to the target repository.

## Project Isolation

Set `project.id` and `repo` for every repository you connect. The autonomous team treats that repository as a separate project: work items, permanent memory, context packs, and lazy tool activation are scoped to that project/repo. Do not reuse one config across unrelated repositories unless you also change the project id and memory namespace.

The default isolation policy requires an explicit repo connection and does not allow cross-project memory.

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

The default scheduler policy also uses `completeLoopBeforeNextWorkItem: true`. That means a new work item does not start until the current loop has reached `CLOSED` or `BLOCKED`, every parallel agent stage has settled, and the workflow claim has been released. Keep this default for one-repo v1 operation; disable it only for intentionally disjoint cross-work-item runs.

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

## Optional Lazy Capabilities

Use `integrations.mcpServers` and `integrations.capabilityPacks` in `agent-team.config.yaml` to give agents extra tools and knowledge only when useful. Configure browser, GitHub, security, database, documentation, and Electron diagnostics as separate on-demand bundles instead of one always-on tool list.

For GitHub, prefer the official GitHub MCP server as a lazy project capability plus the existing GitHub CLI/API fallback. Use read-only scopes by default and enable write-capable GitHub tools only for delivery/release stages that need them.

Recommended defaults:

- keep write-capable bundles disabled or tightly activated
- use tool allowlists where the MCP server exposes many tools
- keep filesystem roots inside the target repo
- use isolated browser/Electron profiles
- keep secrets in environment variables, never in committed config
- convert successful MCP investigation into checked-in tests or durable context

See `docs/lazy-capability-model.md` for the capability catalog.

## GitHub Permissions

Prefer a GitHub App or fine-scoped token with the minimum required permissions:

- issues: read/write
- pull requests: read/write
- contents: read/write
- checks/actions: read
- workflows: write only if dispatching release workflows

## Autonomous Release

Protected branches and required checks should remain enabled. The autonomous controller coordinates release, but GitHub Actions remains the remote release gate.

# Target Repository Setup

The controller can connect multiple repositories. Each connected repository gets its own isolated five-agent team, memory namespace, lazy MCP capability set, work queue scope, and release gates. Add an `agent-team.config.yaml` only when you want a file-backed default project; dashboard/API project connections are stored durably, mirrored to `.agent-team/projects/<project-id>.yaml` for worker resolution, and can run in parallel when project scopes are disjoint. Add the workflow template in `templates/target-repo/.github/workflows/agent-release.yml` to each target repository that should support autonomous release.

## Project Isolation

Set `project.id` and `repo` for every repository you connect. The autonomous team treats that repository as a separate project: work items, permanent memory, context packs, and lazy tool activation are scoped to that project/repo. Do not reuse one config across unrelated repositories unless you also change the project id and memory namespace.

The default isolation policy requires an explicit repo connection and does not allow cross-project memory. The scheduler may run multiple five-agent teams concurrently across different repositories, but it still keeps one complete loop at a time inside each individual repository.

## Project Paths And Mounts

Set `repo.localPath` to the exact local checkout the agents may inspect and modify. For containerized controller/worker runs, mount that same project path into the container at a stable path and use it for command execution, context loading, artifacts, and any filesystem MCP roots.

Docker Compose exposes a narrow default mount for this:

```powershell
$env:TARGET_REPO_HOST_PATH="C:\Users\you\Desktop\your-repo"
$env:TARGET_REPO_CONTAINER_PATH="/workspace/target-repo"
docker compose up -d --build
```

Then connect the project with `localPath: /workspace/target-repo` in the dashboard/API. The controller and worker both receive the same mount, plus a named `gh-config` volume by default. Set `GH_CONFIG_DIR` only when you intentionally want to mount an existing host GitHub CLI config directory instead of using `GH_TOKEN`, `GITHUB_TOKEN`, or `GITHUB_PERSONAL_ACCESS_TOKEN`.

Keep mounts lean:

- target repo checkout
- project `.agent-team` context/artifacts when stored outside the repo
- GitHub CLI config only when you choose mounted `gh` credentials instead of token env vars

Avoid broad home-directory or desktop mounts. Each project connection should make the allowed path obvious.

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

The default scheduler policy also uses `completeLoopBeforeNextWorkItem: true`. That means a new work item for the same repository does not start until the current repo loop has reached `CLOSED` or `BLOCKED`, every parallel agent stage has settled, and the workflow claim has been released. With `allowParallelWorkItemsWhenDisjoint: true`, other connected repositories may run their own five-agent loops at the same time.

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

For GitHub, use the official `github-mcp-server` as a lazy project capability plus GitHub CLI and Octokit. The Docker runtime installs the official MCP binary and `gh`; the controller verifies `gh`, GitHub MCP token readiness, and Octokit repository access during project connection. Dynamic MCP discovery gives agents access to the full documented GitHub MCP toolset surface on demand without loading the entire catalog into every run. Use read-only scopes by default and enable write-capable GitHub tools only for delivery/release stages that need them. GitHub CLI should authenticate through `GH_TOKEN`/`GITHUB_TOKEN`, `GITHUB_PERSONAL_ACCESS_TOKEN`, or a deliberate mount of the user's `gh` config directory, not hardcoded credentials.

Deep web research should also stay on demand. Use it for current official docs, release notes, security advisories, and source-backed investigation that the local repo cannot answer. Keep the returned context small and promote durable findings into `.agent-team/context` or tests.

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

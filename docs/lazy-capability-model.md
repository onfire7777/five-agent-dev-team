# Lazy Capability Model

The agents should be proactive, but the runtime should not expose every tool to every prompt. The controller uses a lazy capability model:

```text
work item + stage + agent role + risk + acceptance criteria
  -> activation rules
  -> selected MCP servers and capability packs
  -> one focused agent run
```

## Default Posture

- Keep repo context, durable memory, and teammate activity always available.
- Scope every capability decision to the connected project/repository.
- Require explicit project paths and mounts before filesystem or GitHub tooling runs.
- Keep MCP servers configured but inactive until their activation rules match.
- Prefer native repo tools and checked-in tests for repeatable work.
- Use MCP tools for live inspection, browser/app debugging, GitHub context, docs lookup, security triage, and database/schema inspection.
- Convert useful MCP exploration into durable code, tests, docs, or memory.

## Recommended Capability Bundles

| Capability | Load When | Primary Tooling | Notes |
| --- | --- | --- | --- |
| `browser-e2e` | UI, accessibility, screenshots, forms, e2e verification | Playwright MCP | Use isolated profiles and narrow tool allowlists. |
| `chrome-diagnostics` | console, network, performance, renderer debugging | Chrome DevTools MCP | Start slim and isolated; enable tracing only for performance tasks. |
| `github-mcp` | issues, PRs, checks, release state, security context | Official GitHub MCP server with dynamic toolsets | Use read-only mode by default. |
| `github-write` | comments, PRs, workflow dispatches | Official GitHub MCP server or existing GitHub API client | Enable only for specific delivery/release tasks. |
| `github-cli` | local branch, PR, workflow, and release operations | `gh` authenticated by env or mounted config | Prefer deterministic CLI commands for local gates and release verification. |
| `deep-web-research` | current ecosystem docs, source-backed investigation, external release notes | Web/search MCP or browser research | Load on demand; cite sources and persist only durable findings. |
| `workspace-read` | code search and repository inspection | Native `rg`, `git`, file reads first | MCP filesystem roots must stay inside the target repo. |
| `workspace-write` | patches and generated files | Native patch/edit tools first | Requires diff review through existing workflow gates. |
| `docs-library` | library/framework research | Context/doc MCPs plus official docs | Treat retrieval as research, not final authority. |
| `security-local` | pre-push/security checks | configured `security` command, Semgrep/Snyk if configured | Never upload secrets or broad local paths. |
| `db-read` | schema/query debugging | vendor MCPs against dev DBs | Read-only user, branch/dev database only. |
| `db-migrate` | migrations and data changes | target repo migration commands | Load only for backend/data work and verify rollback. |
| `electron-diagnostics` | Electron renderer/app investigation | Playwright `_electron`, Chrome DevTools MCP, vetted Electron MCP fork | Do not use the linked prototype directly without hardening. |

## Activation Rules

Every MCP server and capability pack supports:

- `mode`: `manual`, `on_demand`, or `always`
- `stages`: workflow states where the capability is useful
- `agents`: agent roles allowed to use it
- `keywords`: title, request type, risk, priority, or acceptance criteria matches

`manual` keeps a capability documented but inactive. `on_demand` activates only when at least one rule matches. `always` is reserved for small, low-risk knowledge packs like release safety policy.

## GitHub Project Connection

Each project should connect its own GitHub repository explicitly. The recommended GitHub stack is:

- GitHub's official MCP server for issue/PR/check/release/security context when a stage needs GitHub awareness
- GitHub CLI for deterministic local operations and CI/release verification
- Octokit/GitHub REST SDK for controller-owned repository metadata, branch/PR/release coordination, and API-backed verification

Do not let GitHub MCP memory or tool state bleed between repos. Each connected repo gets its own five-agent team envelope, memory namespace, scheduler scope, and capability health report. Use project-specific tokens or GitHub App installation scopes where possible. For local and container runs, provide GitHub CLI credentials with `GH_TOKEN` or `GITHUB_TOKEN`, or mount the user's `gh` config directory into the runtime as a deliberate project capability.

The Docker runtime installs the official `github-mcp-server` binary and configures it as `github-mcp-server stdio --dynamic-toolsets --read-only` by default. Dynamic tool discovery keeps the prompt/tool catalog compact while still allowing the agent to enable any documented GitHub MCP toolset when the work item actually needs it. Provide `GH_TOKEN`, `GITHUB_TOKEN`, `GITHUB_PERSONAL_ACCESS_TOKEN`, or a deliberate `GH_CONFIG_DIR` mount for authenticated access. Remove `--read-only` only for project policies that explicitly allow GitHub MCP writes; controller release gates still own tests, GitHub Actions, merge, tag, release, rollback, and local/remote sync.

## Project Paths And Mounts

Every connected project needs an explicit `repo.localPath`. Containerized runs should mount that host path at a stable container path and use that same path for command execution, context reads, and any filesystem MCP root. Avoid broad home-directory mounts; mount the target repo, optional `.agent-team` artifacts, and GitHub CLI config only when the work item needs them.

## Deep Research

Deep web research is an on-demand capability for questions that local code and repo context cannot answer safely: current dependency behavior, official docs, security advisories, API changes, and release notes. It should return source-backed findings, not large copied pages. Promote durable conclusions into `.agent-team/context` or tests when they affect future work.

## Safety Rules

- Prefer read-only tokens and read-only MCP toolsets.
- Scope filesystem/database/browser profiles to disposable project-local state.
- Keep project mounts narrow and explicit.
- Do not attach write-capable GitHub, database, filesystem, or shell tools unless the current stage needs them.
- Use short timeouts and close MCP sessions after each agent run.
- Keep tool allowlists small; avoid loading huge tool catalogs into coding prompts.
- Treat web/search/doc results as research findings that must be source-checked.
- Release gates remain controller-owned; MCP tools cannot bypass emergency stop, tests, GitHub Actions, rollback, or local/remote sync.

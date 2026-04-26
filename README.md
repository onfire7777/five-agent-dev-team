# Five-Agent Autonomous Software Development Team

Local-first controller for a five-agent autonomous software development team. It runs continuously with Docker Compose, uses Temporal for durable workflows, Postgres for state, GitHub as the delivery surface, and a modern local dashboard for operators.

## Agents

1. **Product & Delivery Orchestrator**: intake, priority, scope, acceptance criteria, routing, final summary.
2. **R&D, Architecture & Innovation Agent**: research, feasibility, prototypes, architecture decisions, build contract.
3. **Frontend & UX Engineering Agent**: UI states, accessibility, client logic, frontend tests.
4. **Backend & Systems Engineering Agent**: APIs, services, data, integrations, backend tests.
5. **Quality, Security, Privacy & Release Agent**: verification, security/privacy review, performance, rollback, autonomous go/no-go.

## Quick Start

```powershell
Copy-Item .env.example .env
npm install
npm run check
docker compose up --build
```

Dashboard: `http://localhost:5173`  
Controller API: `http://localhost:4310`

For host-based development against already-running local Postgres and Temporal:

```powershell
npm run dev
```

## Configuration

Create `agent-team.config.yaml` from `agent-team.config.example.yaml` and point it at one target repo. The target repo must expose install, lint, typecheck, test, build, security, and release commands. The controller will not guess project-specific commands.

Each connected repo is treated as an isolated project. Work items and permanent memory carry a project/repo scope so one repository's decisions, gotchas, and automation state are not mixed into another repository. Connect a repo explicitly in `agent-team.config.yaml` before starting autonomous work on it.

Autonomous activities fail closed when `agent-team.config.yaml` is missing or invalid. Set `AGENT_TEAM_ALLOW_DEFAULT_CONFIG=true` only for local smoke tests where running against the controller checkout is intentional.

## Release Safety Invariant

A completed autonomous loop must leave:

- local target repo clean
- local branch and remote branch synchronized
- no duplicate automation branch for the same work item
- PR checks passing in GitHub Actions
- rollback plan present
- secret scan passing
- release created through the configured GitHub path

Emergency stop is available in the dashboard and through `POST /api/emergency-stop`.

## ChatGPT Pro-Aware Operation

The default `chatgpt_pro_assisted` mode is designed around ChatGPT Pro/Codex-style work: continuous event monitoring, fully autonomous workflow decisions, and controlled parallelism without wasteful always-on model loops. API-backed live mode remains available with `AGENT_EXECUTION_MODE=api_live` and separate OpenAI API billing.

Default parallelism:

- up to 3 active work-item workflows
- up to 5 active agent runs
- 1 serialized repo-write/release lane
- frontend and backend build stages run in parallel after contract lock

## Shared Memory

Agents are context-aware through shared artifacts plus permanent memory. R&D decisions, contracts, release decisions, recurring risks, failures, and stable preferences are stored as typed memory records and injected into future agent runs when relevant.

The lean AutoMaker-inspired context pack lives in the target repo at `.agent-team/context/`. Put only durable rules, architecture notes, and gotchas there; the controller loads them into every relevant agent run without adding dashboard complexity.

## Lazy MCP, Skills, And Plugins

Agents can be configured with MCP servers and capability packs, but they are not loaded into every run. The runner selects tools from the current work item, stage, agent role, risk, and keywords, then closes MCP sessions after that run. This gives the team proactive access to browser automation, Chrome diagnostics, GitHub context, security scanners, database tools, Electron diagnostics, and specialized coding knowledge without bloating normal prompts.

See `agent-team.config.example.yaml` and `docs/lazy-capability-model.md`.

## Model Policy

Live agent runs default to the configured best coding model policy: `gpt-5.5` for coding, research, and review roles, with `gpt-5.4` only as an explicit fallback. Set `AGENT_MODEL` only when you intentionally want to override the per-role model policy.

## API

- `GET /health`
- `GET /api/status`
- `GET /api/work-items`
- `GET /api/memories`
- `GET /api/events`
- `GET /api/events/stream`
- `POST /api/work-items`
- `POST /api/emergency-stop`
- `POST /api/emergency-resume`

## Development Notes

If `AGENT_LIVE_MODE=false`, agents use deterministic local templates so the workflow can be tested without an API key. Set `AGENT_LIVE_MODE=true` and `OPENAI_API_KEY` to use live OpenAI Agents SDK runs.

See `docs/architecture.md` and `docs/target-repo-setup.md` for operational details.

Security note: `npm audit` currently reports a Temporal transitive `uuid` advisory that cannot be fixed safely with non-breaking npm resolution. CodeQL is provided as an opt-in template because GitHub code scanning must be enabled first for this private repo. See `docs/security.md`.

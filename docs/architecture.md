# Architecture

## Runtime

The controller is local-first and designed to run under Docker Compose:

- **Controller API**: Express service used by dashboard and external triggers.
- **Worker**: Temporal worker that executes durable agent workflows.
- **Temporal**: durable workflow execution, retries, and stage orchestration.
- **Postgres**: work-item state, artifacts, controller flags.
- **Dashboard**: Vite/React operator console.

## Workflow

```text
NEW
→ INTAKE
→ RND
→ CONTRACT
→ FRONTEND_BUILD + BACKEND_BUILD
→ INTEGRATION
→ VERIFY
→ RELEASE
→ CLOSED
```

Frontend and backend build stages run in parallel after the contract stage. Release is autonomous only when configured local, remote, quality, security, privacy, rollback, and sync gates pass.

## Smart Continuous Autonomy

The system is a full autonomous team, but it is not designed as five infinite model loops. The controller runs continuously, watches events, chooses the next logical work, and wakes agents only when their stage is unblocked.

Safe parallelism is enabled in four places:

- Product/R&D discovery can run while Quality drafts the verification strategy.
- Frontend and Backend build in parallel after the contract is locked.
- Quality can prepare regression/security plans while implementation runs.
- Multiple work items can run at once when the scheduler has capacity and the repo-write lane remains serialized.

Repo mutations are intentionally constrained by `maxConcurrentRepoWrites: 1` in v1 so autonomous branches, PR updates, merges, and releases do not conflict.

## GitHub Contract

GitHub remains the external source of truth:

- issues define user-visible work
- labels claim and route work
- branches hold implementation
- PRs hold review and release notes
- GitHub Actions provides required remote gates
- releases/tags are the production publication surface

## Safety Controls

Maximum autonomy is enabled by policy, not by bypassing gates. Release can proceed without human approval only if the controller can prove:

- no emergency stop
- clean worktree
- local/remote sync
- no duplicate automation branch
- local checks passed
- GitHub Actions passed
- secret scan passed
- rollback plan exists

## Smart Permanent Memory

Agents share a durable memory layer backed by Postgres. Stage artifacts are promoted into memory records with scope, kind, confidence, importance, permanence, tags, and optional expiry.

Memory scopes:

- `global`: stable team preferences and operating rules
- `repo`: target repository decisions and recurring risks
- `work_item`: decisions, research, risks, failures, and release notes tied to a specific item
- `agent`: role-specific observations

The context builder retrieves relevant non-expired memories and injects them into every agent prompt alongside teammate activity and current artifacts. R&D, contract, and release decisions default to permanent memory; transient build observations stay durable or session-scoped.

Memory is project-isolated by default. Every connected repository gets a project id and repo key, and repo-scoped memory is selected only when it matches that project/repo. Global memory is disabled by default because autonomous teams should not silently transfer one repository's assumptions into another repository.

## Model Policy

Live OpenAI agent runs use the configured model policy instead of an implicit SDK default. The recommended quality-first policy is `gpt-5.5` for coding, research, and release review, with `gpt-5.4` reserved as an explicit fallback. Operators can override with `AGENT_MODEL`, but normal project configs should keep per-role model settings visible.

## Lean AutoMaker-Inspired Features

The project deliberately borrows only the useful operating mechanisms from AutoMaker-style systems, not the full desktop surface area.

- **Repo context packs**: agents can load focused `.md`/`.txt` files from `.agent-team/context` or from explicit config paths. This gives every stage durable repo rules, conventions, and gotchas without adding a separate context-management UI.
- **Dependency-aware scheduling**: work items may declare `dependencies`. The scheduler skips blocked work until dependencies reach `CLOSED`, which preserves safe parallelism without forcing a Kanban board or graph view into the operator console.
- **Durable event spine**: worker and controller lifecycle events are persisted before they are streamed to the dashboard. This keeps operator feedback fast while avoiding raw token/log streaming.
- **Bloat rejected for v1**: Electron packaging, theme marketplaces, integrated terminals, large multi-view sidebars, project galleries, and generic file browsers stay out of scope unless they directly improve autonomous release reliability.

## Lazy Capability Loading

The agents can use MCP servers, skills, plugins, and specialized knowledge packs, but the controller treats them as lazy capabilities. Each capability declares activation rules by workflow stage, agent role, and keywords. A run for a frontend accessibility bug can attach browser tools; a release investigation can attach GitHub and security context; a normal backend fix does not inherit those tool schemas.

This keeps autonomy proactive without sacrificing performance:

- tool catalogs stay small per run
- MCP processes are short-lived and closed after use
- write-capable capabilities are separate from read-only capabilities
- release gates remain controller-owned

See `docs/lazy-capability-model.md` for the recommended catalog and operating rules.

# Automaker Lean Feature Analysis

Research date: 2026-04-25

Sources inspected:

- AutoMaker organization repositories: https://github.com/orgs/AutoMaker-Org/repositories
- AutoMaker: https://github.com/AutoMaker-Org/automaker
- AutoMaker README: https://raw.githubusercontent.com/AutoMaker-Org/automaker/main/README.md
- Autoboard: https://github.com/AutoMaker-Org/autoboard
- Autoboard README: https://raw.githubusercontent.com/AutoMaker-Org/autoboard/main/README.md

## Useful Ideas Adopted

### Repo Context Packs

AutoMaker's context-file pattern is useful because agents need durable project rules and recurring gotchas. This repo implements a lean version:

- default target-repo context directory: `.agent-team/context`
- optional explicit files under `context.files` in `agent-team.config.yaml`
- max file count and byte limits to prevent context bloat
- loaded as repo-scoped permanent memory for agent prompts
- root `.agent-team/` remains local-only, while `templates/target-repo/.agent-team/context/TEAM_RULES.md` documents the target-repo pattern

### Dependency-Aware Scheduling

AutoMaker and Autoboard both model work ordering. This repo adds `dependencies` to work items and blocks scheduler selection until dependencies reach `CLOSED`. That keeps parallel execution aggressive but logically safe.

### Durable Event Spine

AutoMaker's real-time streaming and Autoboard's card-run logs are useful, but their UI surfaces are too broad. This repo adds only the lean core:

- typed `AgentEvent` records
- Postgres-backed event persistence
- `/api/events` for recent events
- `/api/events/stream` for Server-Sent Events
- dashboard EventSource refresh using the existing Events detail view

The stream carries lifecycle summaries, not raw token logs or full terminal output.

## Useful Later

- Specific git worktree primitives for isolated frontend/backend/integration branches
- Safer argv-based git command wrappers instead of string shell commands for git-sensitive operations
- Target-repo path sandboxing with fail-closed defaults
- Playwright verification as a target-repo release gate
- Minimal active-agent rows with elapsed time and current task

## Rejected As Bloat For V1

- Electron packaging
- integrated terminals
- full Kanban drag/drop board
- graph/ideation/wiki/file-editor surfaces
- large settings and theme systems
- provider zoo
- generic project gallery
- broad GitHub issue/PR management UI
- audio notifications and notification center

The product direction stays a local-first autonomous five-agent operator console, not a full IDE replacement.

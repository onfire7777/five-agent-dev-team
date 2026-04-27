# Lean Electron MCP Integration Plan

Research date: 2026-04-26

## Source Status

Browsed current official sources for this draft. Parent should re-check package versions before implementation because the MCP TypeScript SDK is actively changing.

- Electron process model: https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron context isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Electron sandboxing: https://www.electronjs.org/docs/latest/tutorial/sandbox
- Electron IPC renderer API: https://www.electronjs.org/docs/latest/api/ipc-renderer/
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- MCP transports spec: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
- MCP tools spec: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP server quickstart: https://modelcontextprotocol.io/docs/develop/build-server
- MCP local server guide: https://modelcontextprotocol.io/docs/develop/connect-local-servers
- MCP Inspector guide: https://modelcontextprotocol.io/docs/tools/inspector
- MCP TypeScript SDK repository: https://github.com/modelcontextprotocol/typescript-sdk

## Recommendation

Add MCP and Electron as thin local integration layers, not as a new runtime center.

- Keep the controller API, Temporal worker, Postgres state, scheduler, and release gates as the source of truth.
- Add MCP through the lazy capability model, so Electron/browser/debugging tools are visible only for matching work.
- Add Electron later as a secure desktop shell for the existing Vite dashboard, with no Node access in the renderer.
- Do not let Electron or MCP write directly to the target repo, spawn arbitrary commands, bypass emergency stop, or bypass release policy.

The linked `amafjarkasi/electron-mcp-server` should not be integrated directly. The repository is useful as a CDP debugging reference, but it is prototype-grade: no release artifact, no published package, weak protocol hygiene, limited tool implementation, and broad remote-debugging risks. Use Playwright `_electron` for repeatable tests, Chrome DevTools MCP for renderer/performance diagnostics, and only a vetted/forked Electron MCP for local investigation.

## Current Repo Fit

The repo already has the pieces a lean desktop/MCP integration should reuse:

- Controller API on `http://127.0.0.1:4310`: status, work items, memories, events, emergency stop/resume.
- Dashboard on Vite/React, already using browser `fetch` and `EventSource`.
- Shared TypeScript/Zod models in `packages/shared`.
- Durable release policy and serialized repo-write lane in the worker/controller path.

There is no Electron dependency and no MCP dependency today. That is good for v1: the plan should avoid coupling desktop packaging, MCP protocol work, and autonomous release logic in one large change.

## Non-Goals

- No full IDE, terminal, generic file browser, project gallery, theme marketplace, or Kanban rebuild.
- No MCP tool that directly edits files, runs arbitrary shell commands, merges branches, or creates releases.
- No Electron renderer access to `fs`, `child_process`, Git, Docker, environment variables, API keys, or raw MCP process handles.
- No broad remote MCP server support in the first pass.

## Proposed Architecture

```text
MCP host/client
  -> stdio MCP server
      -> typed controller client
          -> existing Express controller
              -> store, scheduler, Temporal, worker, release gates

Electron main process
  -> creates secure BrowserWindow
      -> existing Vite dashboard renderer
          -> existing controller HTTP/SSE API
```

Keep the Electron and MCP paths sibling integrations. Electron does not need to host the MCP server in v1; MCP clients can launch the server by stdio just like other local MCP servers.

## MCP Server Shape

Use stdio first. MCP's transport spec defines stdio for client-spawned local servers, and the TypeScript server guide recommends stdio for local integrations. This fits Claude Desktop, CLI clients, and local operator workflows without opening a network port.

Candidate module:

- `apps/mcp-server/src/index.ts` later, or a small `packages/mcp` if shared by multiple launchers.
- Connect with the production-recommended MCP SDK generation after a package spike.
- Reuse or derive Zod schemas from the existing controller request/response shapes.
- Log to stderr only for stdio servers. MCP docs warn that stdout must contain only protocol JSON-RPC messages.

Initial tool surface:

| Name | Kind | Controller mapping | Safety |
| --- | --- | --- | --- |
| `agent_team_get_status` | read | `GET /api/status` | Safe, structured output. |
| `agent_team_list_work_items` | read | `GET /api/work-items` | Safe, allow filters later. |
| `agent_team_list_events` | read | `GET /api/events?limit=n` | Safe, limit and redact. |
| `agent_team_list_memories` | read | `GET /api/memories` | Safe, optional `workItemId`. |
| `agent_team_create_work_item` | write | `POST /api/work-items` | Requires explicit user approval in MCP host. Mirrors existing schema. |
| `agent_team_emergency_stop` | control | `POST /api/emergency-stop` | Sensitive, require reason and explicit approval. |
| `agent_team_emergency_resume` | control | `POST /api/emergency-resume` | Sensitive, explicit approval. |

Resources can come after tools prove stable:

- `agent-team://status`
- `agent-team://work-items`
- `agent-team://work-items/{id}`
- `agent-team://events/recent`

Prompts are optional and should stay narrow:

- `draft_work_item`: turn a user request into title, type, risk, and acceptance criteria.
- `release_gate_review`: summarize status, events, and release readiness for operator review.

## Electron Shell Shape

Electron should wrap the dashboard, not replace it.

- Main process owns app lifecycle, tray/menu later, and window creation.
- Renderer remains the existing React dashboard.
- Preload exposes only a tiny typed API if desktop-only features are required.
- Prefer loading the local built dashboard for packaged mode and Vite dev server for development.
- Keep the dashboard's HTTP/SSE communication with the controller unchanged.

Security defaults:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- strict Content Security Policy
- deny or explicitly handle navigation to unexpected origins
- open external links through the OS browser, not inside the privileged app window
- do not expose `ipcRenderer` directly over `contextBridge`

Electron's docs describe the main process as the Node-capable lifecycle/window owner and renderers as browser-like web processes. They also note that context isolation is the recommended/default model and that sandboxed renderers must delegate privileged work through IPC.

## Transport Decision

Use stdio for v1 MCP.

Streamable HTTP is useful later if the MCP server must support multiple simultaneous clients or if the desktop app itself becomes an MCP host. If Streamable HTTP is added:

- bind only to `127.0.0.1`, not `0.0.0.0`
- validate `Origin`
- require local authentication/session tokens
- support current MCP protocol headers and session behavior
- keep it separate from the public controller API unless there is a strong reason to combine them

The MCP transport spec explicitly warns local HTTP servers to validate `Origin`, bind to loopback, and implement authentication to avoid DNS rebinding and unwanted local access.

## Dependency Notes

Implementation needs a short SDK spike before code lands.

- Official MCP docs still show the v1 `@modelcontextprotocol/sdk` quickstart.
- The TypeScript SDK repository currently describes a developing v2 split-package layout with `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, and optional middleware packages.
- The same repository says v1.x remains the recommended production line until v2 stabilizes.
- This repo already uses `zod` v4. The SDK choice should verify Zod compatibility and avoid dependency churn.

Practical default: implement against the production-recommended SDK line unless the parent verifies that v2 is stable and compatible at implementation time.

## Safety Invariants

- MCP tools call the controller API; they do not reach around it.
- The controller remains responsible for emergency stop, scheduling, release policy, and repo-write serialization.
- Every write/control MCP tool has schema validation, timeout handling, structured error output, and audit logging.
- Tool results never include secrets, raw environment variables, tokens, or full command logs.
- Tool names are stable and obvious to avoid lookalike-tool risk.
- The desktop renderer never receives privileged Node/Electron objects.
- Roots, if ever supported by an MCP client, are treated as advisory scope signals, not a security boundary.

## Phased Plan

1. MCP adapter spike
   - Pick SDK generation and package names.
   - Build a local stdio server with `get_status` and `list_work_items`.
   - Verify with MCP Inspector.

2. MCP write tools
   - Add `create_work_item`, `emergency_stop`, and `emergency_resume`.
   - Require user-visible confirmation through the host for write/control tools.
   - Add tests for schemas, controller error mapping, and stdout cleanliness.

3. Electron shell
   - Add minimal main/preload structure.
   - Load existing dashboard.
   - Preserve renderer sandbox and context isolation.
   - Add basic window lifecycle and controller connectivity state.

4. Desktop packaging
   - Only after MCP and shell behavior are stable.
   - Add build/package scripts, signing/notarization strategy as needed, and release assets.
   - Keep this separate from the first MCP server merge.

5. Optional MCP client mode
   - Consider only if the desktop app needs to connect to external MCP servers.
   - Treat external MCP servers as untrusted: clear tool listing, explicit approval, timeout/rate limits, and no target-repo root grants by default.

## Validation Checklist

- `npm run check` remains the repo baseline.
- MCP Inspector can connect, list tools, call each tool, and show useful errors for invalid inputs.
- A local MCP host config can launch the stdio server with absolute paths on Windows.
- Stdio server writes protocol messages only to stdout and logs only to stderr.
- Dashboard still works in browser mode without Electron.
- Electron smoke test confirms the dashboard loads, no Node APIs are exposed to renderer, navigation is constrained, and controller offline state is understandable.
- Emergency stop/resume through MCP and dashboard both update the same controller state.

## Open Decisions For Parent

- Should Electron manage starting Docker Compose/controller, or only detect and explain controller availability? Lean v1 should only detect.
- Should MCP ship before Electron? Recommended: yes, because it is smaller and validates the controller contract.
- Which MCP SDK generation should implementation pin after the package spike?
- Which MCP host is the first compatibility target: Claude Desktop, Codex, Cursor, or a local test harness?

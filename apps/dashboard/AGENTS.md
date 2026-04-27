# Dashboard Rules

- Optimize for a dense, usable operator dashboard, not a marketing page.
- Verify loading, empty, error, keyboard, focus, and responsive states.
- Keep API defaults local and explicit.
- Do not change backend contracts, CI workflows, Docker, or dependency versions
  from this lane; write a handoff to the owning lane instead.
- Validate dashboard changes with `npm run check` and E2E/browser smoke tests
  when available.

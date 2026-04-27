# Controller Rules

- Keep controller APIs explicit, typed, and covered by tests.
- Preserve local-first defaults and bind local services to `127.0.0.1` unless a
  documented runtime requirement says otherwise.
- Do not change dashboard UI, CI workflows, Docker, or dependency versions from
  this lane; write a handoff to the owning lane instead.
- Validate controller changes with `npm run check` and targeted backend tests
  when available.

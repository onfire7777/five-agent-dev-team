# Controller Rules

- Keep controller APIs explicit, typed, and covered by tests.
- Validate request input with shared schemas.
- Keep response contracts stable unless an RFC/contract explicitly changes them.
- Preserve local-first defaults and bind local services to `127.0.0.1` unless a
  documented runtime requirement says otherwise.
- Do not broaden CORS, OAuth, token, or GitHub auth defaults without
  Security/DevOps review.
- Do not change dashboard UI, CI workflows, Docker, or dependency versions from
  this lane; write a handoff to the owning lane instead.
- Validate controller changes with `npm run check` and targeted backend tests
  when available.

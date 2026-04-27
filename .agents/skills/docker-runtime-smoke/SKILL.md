---
name: docker-runtime-smoke
description: Verify Docker Compose runtime health without leaking resolved environment values.
---

# Docker Runtime Smoke

- First run `docker compose config --no-interpolate`.
- Do not paste resolved Compose output into logs, state, or PR bodies.
- Use `npm run verify:runtime` for runtime smoke.
- If runtime fails, capture only service name, check name, and symptom.
- Always bring Compose down after smoke validation.

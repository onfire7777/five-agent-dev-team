---
name: ci-failure-router
description: Classify failing checks and assign the correct specialist stage.
---

# CI Failure Router

Use `node scripts/ci-failure-router.mjs --text=<summary>` or pipe log text to it.

Routing:

- Gitleaks, workflow permissions, Docker, npm audit: Security/DevOps.
- Controller, schemas, store, worker, Temporal: Backend/Core.
- Dashboard, CSS, browser, Playwright UI: Frontend/UX.
- Assertions, flaky tests, coverage, reproduction: Quality/Debug.
- Docs or acceptance mismatch: Docs/Alignment.
- Merge conflict, stale branch, divergence: Captain.

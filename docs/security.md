# Security Notes

## Dependency Audit

`npm audit --audit-level=moderate` currently reports a moderate advisory for `uuid@11.1.0` through the Temporal TypeScript SDK dependency chain.

Current status:

- `npm audit fix` cannot resolve it.
- `npm audit fix --force` proposes a breaking downgrade of `@temporalio/worker`, so it is not applied.
- The project does not call the affected `uuid` buffer APIs directly.

Operational mitigation:

- Keep Temporal packages current.
- Re-run `npm audit --audit-level=moderate` before release.
- Replace or override the dependency only after Temporal publishes a compatible fix or after validating an override against the worker runtime.

# Security Notes

## Dependency Audit

`npm audit --audit-level=moderate` currently reports a moderate advisory for `uuid@11.1.0` through the Temporal TypeScript SDK dependency chain.

Current status:

- `npm audit fix` cannot resolve it.
- `npm audit fix --force` proposes a breaking downgrade of `@temporalio/worker`, so it is not applied.
- The project does not call the affected `uuid` buffer APIs directly.

Operational mitigation:

- Keep Temporal packages current.
- CI and the release template block high-or-worse advisories and run a non-blocking moderate audit report so this accepted exception remains visible.
- Replace or override the dependency only after Temporal publishes a compatible fix or after validating an override against the worker runtime.

## Code Scanning

The repository includes a CodeQL workflow template at `templates/github/codeql.yml`, but it is not enabled in `.github/workflows` by default because GitHub rejected CodeQL uploads for this private repo with: `Code scanning is not enabled for this repository`.

Enable code scanning/GitHub Advanced Security in repository settings first, then copy the template into `.github/workflows/codeql.yml`.

# Security Notes

## Dependency Audit

`npm audit --audit-level=moderate` must pass with zero production dependency vulnerabilities.

Current status:

- The Temporal TypeScript SDK currently resolves its transitive `uuid` dependency through the root `overrides` policy in `package.json`.
- `npm run audit:security` treats production `moderate`, `high`, and `critical` advisories as blocking.
- A dependency override must be validated against the runtime imports that consume it before merge.

Operational mitigation:

- Keep Temporal packages current.
- CI runs `npm run audit:security` and fails on every production moderate-or-worse advisory.
- Remove dependency overrides after upstream packages publish compatible fixed dependency ranges.

## Code Scanning

The repository includes a CodeQL workflow template at `templates/github/codeql.yml`, but it is not enabled in `.github/workflows` by default because GitHub rejected CodeQL uploads for this private repo with: `Code scanning is not enabled for this repository`.

Enable code scanning/GitHub Advanced Security in repository settings first, then copy the template into `.github/workflows/codeql.yml`.

## Local Runtime Exposure

Docker Compose binds Postgres, Temporal, the controller, and the dashboard to `127.0.0.1` by default. Keep those bindings local unless you deliberately put the controller behind authentication and a trusted network boundary.

The controller accepts browser requests only from `CORS_ORIGINS`, which Compose defaults to `http://127.0.0.1:5173`. Add `http://localhost:5173` explicitly through `CORS_ORIGINS` if that host name is needed. Keep write-capable endpoints such as emergency stop and work-item creation off broad CORS policies.

## GitHub Credentials

Use a GitHub App installation token or a fine-scoped token for autonomous agent work. Avoid broad classic personal access tokens because write-capable agents can create branches, comment on PRs, trigger workflows, and release code through whatever scopes the token has.

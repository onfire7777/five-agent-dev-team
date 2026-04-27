# CI and Security Rules

- Keep workflow permissions least-privilege.
- Secret scanning must not require write permissions.
- Prefer `contents: read` and `pull-requests: read`.
- Put secret scanning in its own job, not inside every Node matrix cell.
- Use CI concurrency to cancel stale automation runs.
- Do not use `pull_request_target` unless it has been threat-modeled.
- Do not add secrets or resolved environment values to workflow logs.
- Docker validation in reportable contexts should use
  `docker compose config --no-interpolate`.

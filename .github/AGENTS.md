# CI and Security Rules

- Keep workflow permissions least-privilege.
- Secret scanning must not require write permissions.
- Prefer `contents: read` and `pull-requests: read`.
- Do not add secrets or resolved environment values to workflow logs.
- Keep CI concurrency enabled when safe.
- Matrix tests should not duplicate expensive global security jobs unless there
  is a clear reason.
- Docker validation in reportable contexts should use
  `docker compose config --no-interpolate`.

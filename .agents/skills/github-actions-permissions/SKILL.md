---
name: github-actions-permissions
description: Keep GitHub Actions permissions explicit, least-privilege, and compatible with PR metadata access.
---

# GitHub Actions Permissions

- Prefer workflow-level `contents: read` and `pull-requests: read`.
- Add narrower job permissions only when needed.
- Secret scanning must not require write permissions.
- Never use `pull_request_target` without explicit threat modeling.

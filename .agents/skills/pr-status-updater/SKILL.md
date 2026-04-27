---
name: pr-status-updater
description: Update one structured PR status block instead of spamming PR comments.
---

# PR Status Updater

Use:

`node scripts/update-pr-status.mjs --pr=<number> --stage=<stage> --status=<status> --notes=<short-note>`

Keep notes short. Include validation and blockers in the PR body, not as repeated comments.

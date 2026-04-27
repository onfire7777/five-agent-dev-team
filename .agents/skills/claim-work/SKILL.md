---
name: claim-work
description: Acquire and release file-lane claims before mutating automation-controlled branches.
---

# Claim Work

Use before edits in Stages 1-5.

1. Determine stage, branch, PR, file globs, and reason.
2. Run `node scripts/claim-work.mjs --stage=<stage> --branch=<branch> --pr=<pr> --files=<globs> --reason=<reason>`.
3. Do not edit files outside the claim.
4. Release with `node scripts/claim-work.mjs --release=<claim-id>` when safe.
5. Expired claims are blockers, not automatic cleanup.

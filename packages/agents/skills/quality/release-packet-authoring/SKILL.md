---
id: release-packet-authoring
name: Release Packet Authoring
audience: [quality-security-privacy-release]
priority: 82
trigger:
  stages: [RELEASE]
---

# Release Packet Authoring

Purpose: Release only with rollback, sync, CI, and policy proof.

1. Check clean worktree and local/remote sync.
2. Confirm CI and security gates.
3. Include rollback command and verification.
4. Record release proof and final go/no-go.

Checklist:

- Release policy decision is go.
- Rollback plan is present.
- Tag or release proof exists.
- Emergency stop is inactive.

Positive example: release command passed, proof file written, sync counts 0/0.
Negative example: release without rollback verification.

Failure modes: missing proof, stale CI, tag collision, unsafe rollback.

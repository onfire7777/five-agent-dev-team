---
name: spec-hash-check
description: Detect drift in frozen spec, automation guide, queue, and swarm state.
---

# Spec Hash Check

Use:

- `node scripts/spec-hash.mjs` to inspect hashes.
- `node scripts/spec-hash.mjs --write` only after intentional state or guide updates.

Unexpected hash drift is a blocker. Write a receipt and route to Captain.

---
name: no-op-handoff
description: Stop cleanly when a stage has no safe assigned work.
---

# No-Op Handoff

No-op when work is owned by another stage, blocked, unsafe, stale, duplicate, or unqueued.

Required output:

- receipt mode `no-op` or `blocked`
- compact reason
- owning stage
- next safe action

No-op is a valid productive result.

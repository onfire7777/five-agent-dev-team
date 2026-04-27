---
id: final-summary
name: Final Summary
audience: [product-delivery-orchestrator]
priority: 70
trigger:
  stages: [CLOSED]
---

# Final Summary

Purpose: Close loops with durable evidence.

1. Summarize completed stages and files.
2. Include tests and gates actually run.
3. Persist latest-loop memory.
4. Recommend the next loop only when evidence supports it.

Checklist:

- Closure names release or blocker state.
- Sync and rollback evidence are included when relevant.
- No future work is hidden as complete.

Positive example: closed with release tag, CI, sync, rollback proof.
Negative example: closed while verification artifact is blocked.

Failure modes: premature closure, missing latest-loop memory, vague follow-up.

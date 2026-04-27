---
name: temporal-workflow-safety
description: Keep Temporal worker and workflow changes deterministic and recoverable.
---

# Temporal Workflow Safety

- Keep workflow logic deterministic.
- Avoid hidden network, time, random, or filesystem dependencies inside workflows.
- Put side effects behind activities.
- Add tests for retry, failure, and idempotency behavior when workflow logic changes.
- Verify worker health and queue assumptions before readiness.

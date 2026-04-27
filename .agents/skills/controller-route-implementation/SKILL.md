---
name: controller-route-implementation
description: Implement controller routes with stable validation, auth, and regression coverage.
---

# Controller Route Implementation

- Validate inputs through shared schemas.
- Keep response envelopes stable and typed.
- Preserve auth, CORS, and token defaults unless Security/DevOps reviews the change.
- Add route-level regression tests for new behavior.
- Document API behavior only after tests verify it.

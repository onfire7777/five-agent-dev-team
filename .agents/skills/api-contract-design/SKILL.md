---
name: api-contract-design
description: Design backend API contracts that remain stable across dashboard and worker callers.
---

# API Contract Design

- Model resources as typed shared schemas.
- Validate incoming request bodies.
- Keep response envelopes stable.
- Add route-level regression tests for new behavior.
- Coordinate breaking changes through RFC and shared contract updates.

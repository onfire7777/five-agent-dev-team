---
id: api-contract-design
name: API Contract Design
audience: [backend-systems-engineering]
priority: 78
trigger:
  stages: [BACKEND_BUILD, INTEGRATION]
  keywords: [api, endpoint, schema, controller]
---

# API Contract Design

Purpose: Keep controller APIs stable, scoped, and schema-validated.

1. Parse request bodies and query parameters with zod.
2. Require project scope for project data.
3. Return precise error messages and HTTP codes.
4. Keep response shapes predictable for the dashboard.

Checklist:

- Input schemas exist.
- Scope is enforced before reads/writes.
- Errors fail closed.
- Tests cover invalid input.

Positive example: reject negative event limit with HTTP 400.
Negative example: list all memories without project scope.

Failure modes: unscoped reads, silent coercion, inconsistent response envelopes.

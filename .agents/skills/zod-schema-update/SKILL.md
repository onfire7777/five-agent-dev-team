---
name: zod-schema-update
description: Update shared Zod schemas while preserving cross-lane API compatibility.
---

# Zod Schema Update

- Prefer additive schema changes.
- Keep request validation and response contracts aligned.
- Update generated/shared types, backend validation, and dashboard callers together.
- Add focused tests for invalid input and successful contract use.
- Do not introduce breaking schema changes without an RFC.

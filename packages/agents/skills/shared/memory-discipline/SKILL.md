---
id: memory-discipline
name: Memory Discipline
audience:
  [
    product-delivery-orchestrator,
    rnd-architecture-innovation,
    frontend-ux-engineering,
    backend-systems-engineering,
    quality-security-privacy-release
  ]
priority: 95
trigger:
  always: true
---

# Memory Discipline

Purpose: Write only durable, scoped lessons to memory and keep transient detail in artifacts.

1. Classify facts as ephemeral, loop, durable, or permanent.
2. Store repo-scoped decisions, recurring failures, release facts, and handoffs.
3. Do not store secrets, raw logs, or cross-project assumptions.
4. Prefer short, searchable titles and concrete evidence.

Checklist:

- Project and repo scope are present.
- Memory is useful in a future loop.
- No secret or personal token is stored.
- Content is concise.

Positive example: "Release blocked because rollback proof was missing" with gate evidence.
Negative example: storing full terminal output with environment variables.

Failure modes: prompt bloat, cross-repo leakage, durable storage of temporary observations.

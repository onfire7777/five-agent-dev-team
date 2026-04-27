---
id: build-contract-design
name: Build Contract Design
audience: [rnd-architecture-innovation]
priority: 80
trigger:
  stages: [CONTRACT]
---
# Build Contract Design

Purpose: Give frontend and backend agents a stable implementation boundary.

1. Define data shapes, endpoints, and UI states.
2. Mark assumptions and non-goals.
3. Specify validation and rollback expectations.
4. Keep the contract small enough to build in one loop.

Checklist:
- Frontend and backend responsibilities are separated.
- Acceptance criteria map to checks.
- Risks have owners.
- Contract changes require a new handoff.

Positive example: endpoint schema plus dashboard state map.
Negative example: leave API shape to builder preference.

Failure modes: ambiguous boundary, missing tests, contract drift.

---
id: adr-authoring
name: ADR Authoring
audience: [rnd-architecture-innovation]
priority: 75
trigger:
  stages: [RND, CONTRACT]
  keywords: [architecture, adr, decision, tradeoff]
---
# ADR Authoring

Purpose: Record important technical decisions with alternatives and consequences.

1. State context and constraints.
2. Name the decision in specific terms.
3. List at least two alternatives.
4. Include positive and negative consequences.

Checklist:
- One decision only.
- Alternatives are plausible.
- Downsides are explicit.
- Follow-up decisions are named.

Positive example: choose local-first Postgres plus Temporal because durable state is load-bearing.
Negative example: "use modern tech" without alternatives.

Failure modes: advocacy without tradeoffs, vague consequences, combined decisions.

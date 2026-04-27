---
id: intake-classification
name: Intake Classification
audience: [product-delivery-orchestrator]
priority: 70
trigger:
  stages: [INTAKE]
---

# Intake Classification

Purpose: Convert a request into a bounded work item.

1. Identify user goal, technical goal, risk, and affected areas.
2. Write testable acceptance criteria.
3. Decide whether R&D, frontend, and backend are needed.
4. Push ambiguity into open questions or proposal risks.

Checklist:

- Scope in and out are clear.
- Acceptance criteria are testable.
- Routing flags match the work.
- Risk level is justified.

Positive example: bug fix with backend only and one regression test.
Negative example: broad "improve app" routed to every team with no criteria.

Failure modes: oversized scope, untestable criteria, hidden risk.

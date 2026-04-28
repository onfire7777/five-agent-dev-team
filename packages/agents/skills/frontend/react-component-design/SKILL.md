---
id: react-component-design
name: React Component Design
audience: [frontend-ux-engineering]
priority: 75
trigger:
  stages: [FRONTEND_BUILD]
  keywords: [react, ui, dashboard, component]
---

# React Component Design

Purpose: Build compact, accessible React UI aligned with the contract.

1. Keep state local unless shared behavior needs lifting.
2. Use semantic controls and labels.
3. Avoid placeholder/sample data in production UI.
4. Verify desktop and mobile behavior.

Checklist:

- Components fit existing app conventions.
- Loading, empty, error, and offline states are real.
- Controls update state or call APIs.
- No horizontal scroll at 360px.

Positive example: selector-driven insights panel using live API data.
Negative example: decorative cards with inert buttons.

Failure modes: sample data leakage, inaccessible controls, layout overflow.

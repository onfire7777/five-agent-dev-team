---
name: npm-audit-policy
description: Apply npm audit checks without unsafe forced dependency churn.
---

# npm Audit Policy

- Run `npm audit --audit-level=high`.
- Run `npm run audit:security`.
- Never run `npm audit fix --force`.
- Queue dependency changes separately unless required for the active blocker.

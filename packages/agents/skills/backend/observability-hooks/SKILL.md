---
id: observability-hooks
name: Observability Hooks
audience: [backend-systems-engineering]
priority: 70
trigger:
  stages: [BACKEND_BUILD, INTEGRATION, VERIFY]
  keywords: [event, log, telemetry, audit]
---

# Observability Hooks

Purpose: Emit useful local evidence without leaking secrets or adding telemetry.

1. Emit project-scoped events for stage starts, completions, drops, and blockers.
2. Redact secrets and token-like values.
3. Avoid external analytics or crash reporting.
4. Preserve enough detail to debug failed gates.

Checklist:

- Events include work item when known.
- Messages are concise.
- No secrets in payloads.
- Failure events name the gate.

Positive example: MCP capability dropped with name and sanitized reason.
Negative example: log full environment.

Failure modes: noisy logs, missing blocker evidence, secret leakage.

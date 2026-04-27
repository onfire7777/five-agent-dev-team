---
id: secure-coding
name: Secure Coding
audience: [product-delivery-orchestrator, rnd-architecture-innovation, frontend-ux-engineering, backend-systems-engineering, quality-security-privacy-release]
priority: 92
trigger:
  always: true
---
# Secure Coding

Purpose: Keep autonomous changes safe by default.

1. Validate inputs at boundaries with schemas.
2. Keep secrets in environment variables only.
3. Reject unsafe paths that leave the project or target repo.
4. Prefer allowlists for tools, origins, commands, and release gates.

Checklist:
- Inputs are parsed before use.
- Secrets are not logged.
- Paths remain scoped.
- Failures block safely.

Positive example: reject a configured context file outside repo root.
Negative example: pass a token as a command argument.

Failure modes: insecure defaults, broad CORS, unsanitized shell input, unscoped filesystem reads.

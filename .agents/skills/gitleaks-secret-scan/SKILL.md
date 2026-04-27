---
name: gitleaks-secret-scan
description: Keep secret scanning effective without leaking values or weakening CI.
---

# Gitleaks Secret Scan

- Run secret scanning once per PR workflow, not per matrix cell.
- Use full history when needed with `fetch-depth: 0`.
- Do not paste raw secret-scan output if token-like values appear.
- Fix permission errors without granting write access.

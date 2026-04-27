---
name: stage-receipt
description: Write one machine-readable receipt for each automation run and append the ledger.
---

# Stage Receipt

Every run writes exactly one receipt.

Use:

`node scripts/write-stage-receipt.mjs --stage=<stage> --mode=<mode> --files=<files> --checks=<checks> --passed=<true|false> --handoff=<summary>`

Modes: `no-op`, `mutated`, `blocked`, `verified`, `routed`, `merged`, `cleanup`.

Receipts must be compact and must not contain raw logs or secrets.

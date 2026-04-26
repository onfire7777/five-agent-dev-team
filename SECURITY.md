# Security Policy

## Supported Version

This project is early-stage. Security fixes apply to the current `main` branch unless a release branch is created later.

## Reporting a Vulnerability

Open a private GitHub security advisory or contact the repository owner directly. Do not disclose exploitable details publicly until a fix is available.

## Security Gates

Autonomous releases are expected to pass:

- dependency audit or documented exception
- secret scan
- local test/build checks
- GitHub Actions checks
- rollback plan verification
- local/remote sync verification

Known dependency audit exceptions are tracked in `docs/security.md`.

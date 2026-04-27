# Acceptance Matrix

| ID                 | Phase    | Requirement                                                                              | Evidence                                                                  | Command                   |
| ------------------ | -------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------- |
| P0-HYGIENE         | Phase 0  | Root project exposes repeatable install, lint, format, typecheck, test, and build gates. | `package.json`, `eslint.config.mjs`, `.prettierrc`, `.prettierignore`     | `npm run check`           |
| P8-DASHBOARD-SMOKE | Phase 8  | Dashboard loads for desktop and 360px mobile without horizontal viewport overflow.       | `playwright.config.ts`, `tests/e2e/dashboard-smoke.spec.ts`               | `npm run test:e2e`        |
| P10-TRACEABILITY   | Phase 10 | Acceptance expectations are documented and guarded by an executable traceability test.   | `docs/acceptance-matrix.md`, `tests/acceptance/acceptance-matrix.test.ts` | `npm run test:acceptance` |

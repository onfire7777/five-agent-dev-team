# Contributing

## Local Setup

```powershell
npm install
npm run check
```

## Development

- Keep changes focused and covered by tests.
- Update docs when behavior, configuration, or release policy changes.
- Do not commit machine-local config such as `.env` or `agent-team.config.yaml`.
- Keep autonomous release controls conservative unless the release policy explicitly allows a broader behavior.

## Pull Request Expectations

Every PR should include:

- summary of behavior changes
- validation commands run
- release or rollback notes when relevant
- security/privacy impact when relevant

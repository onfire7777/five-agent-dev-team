# Agent Package Rules

- Keep agent behavior deterministic enough to test.
- Document tool assumptions and stop conditions near reusable agent skills.
- Do not bake user-specific paths, credentials, or repo-private facts into
  reusable package code.
- Add focused regression coverage for state-machine or orchestration changes.

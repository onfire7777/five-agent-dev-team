# Agent Skill Rules

- Keep each skill narrow, named by the job it performs, and testable by a clear
  acceptance example.
- Include allowed inputs, expected outputs, and failure behavior.
- Do not bake credentials, user-specific paths, or private repo details into
  reusable skills.
- Security-sensitive skills must include prompt-injection and secret-handling
  notes.

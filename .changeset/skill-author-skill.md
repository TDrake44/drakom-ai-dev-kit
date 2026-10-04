---
"@drakom/ai-dev-kit": minor
---

A new kit-managed skill, `drakom-skill-author`, helps projects build their own skills after adoption. It finds candidates from repeated work in git and pull request history, CI configuration, package scripts, contribution docs, and plans. It drafts short skills that route to rules and include verification and approval points, checks each draft against a recent real task, and refines or retires skills that go stale. It asks for approval before creating or changing any project skill. A companion reference, `.agents/skills/drakom-skill-author/references/skill-patterns.md`, describes common skill archetypes and includes a worked example. `init` installs both files, and `sync` adds them to existing installs. The `drakom-ai-setup` skill now hands approved skill additions to `drakom-skill-author`, and the managed `AGENTS.md` block names the new skill.

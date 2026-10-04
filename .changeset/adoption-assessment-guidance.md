---
"@drakom/ai-dev-kit": minor
---

The `drakom-ai-setup` skill and its assessment plan template now record each relevant context source under Keep, Refine, Add, or Omit with its evidence, ownership, rationale, destination or action, dependencies, approval status, and verification. Setup lists `.drakom-ai/plans/` and `.drakom-ai/specs/` explicitly, because search tools that honour `.gitignore` skip them, and states that Omit never means delete. A new rule-authoring reference, `.agents/skills/drakom-ai-setup/references/rule-anatomy.md`, describes the anatomy, size budget, and common types of project rules; `init` installs it, and `sync` adds it to existing installs. `init` output now lists the detected context source paths before the planned operations.

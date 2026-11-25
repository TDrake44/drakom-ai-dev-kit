---
"@drakom/ai-dev-kit": minor
---

Adds the `drakom-dev` skill, installed with `npx skills add TDrake44/drakom-ai-dev-kit` (the CLI does not install it). It builds one pull request's worth of work from a plan or a request: a failing test first for a behavior change, the repo's verification commands, a re-read of the diff and a report. It reads the commands and rules from `AGENTS.md` or `CLAUDE.md`, plus `.drakom-ai/rules/verification.md` and `.drakom-ai/rules/dev.md` when present, updates the status line of the work's plan when one exists, and then offers `drakom-review` here or in a fresh session through `drakom-handoff` when those are installed.

---
"@drakom/ai-dev-kit": minor
---

Adds the `drakom-handoff` skill, installed with `npx skills add TDrake44/drakom-ai-dev-kit` (the CLI does not install it). It writes a prompt a fresh session can start from to pick up the next step, printed in the chat for the user to copy, and updates the status line of the work's plan when one exists. When the tool has no subagents, `drakom-review` now offers a fresh session for its reviewer, with the prompt written by `drakom-handoff` when that skill is installed.

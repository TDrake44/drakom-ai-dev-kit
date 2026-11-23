---
"@drakom/ai-dev-kit": minor
---

The kit's skills move to a root `skills/` folder, so `npx skills add TDrake44/drakom-ai-dev-kit` installs `drakom-ai-setup` and `drakom-plan-audit` at user level (`-g`) or project level. The CLI reads them from there and installs them to the same places as before.

`drakom-skill-author` is removed. On a project that has it, sync reports a conflict for its two files; delete the folder or keep it as your own skill, then release both paths (see Upgrading). The setup skill now suggests skills worth adding without writing them, and names its references relative to its own folder.

---
"@drakom/ai-dev-kit": minor
---

- `init` now creates the Claude Code skill mirrors in `.claude/skills/`, so a freshly initialized project passes `sync --check` and `/drakom-ai-setup` works in Claude Code without running `sync` first.
- `drakom-plan-audit` is now installed by default. Existing projects receive it, its Claude mirror, and an updated `AGENTS.md` block on their next `sync`. The interactive prompt and the `--with-plan-audit` flag are removed; passing the flag now fails as an unknown option.
- Unknown `init` and `sync` options now report "Unknown option" instead of naming the wrong command.

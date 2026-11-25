# Review Rules

The review rules themselves are in `AGENTS.md` § Code Review Rules. This file adds what
`drakom-review` needs that is specific to this machine's tools.

## Risk check tier

Run the blind risk check on each tool's cheap tier, named explicitly, at medium effort. Never rely
on the tool's default model.

| Tool | Cheap tier |
| --- | --- |
| Claude Code | `haiku` |
| Codex | the newest Luna model (`codex exec -m <luna slug>`; slugs are in `~/.codex/models_cache.json`) |
| Antigravity | the newest Gemini Hydrogen model (`agy models` lists them) |

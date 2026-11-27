# Review Rules

The review rules themselves are in `AGENTS.md` § Code Review Rules. This file adds what
`drakom-review` needs that is specific to this machine's tools.

## Risk check tier

Run the blind risk check on each tool's cheap tier, named explicitly, at medium effort. Never rely
on the tool's default model. Use only the row for the tool running the review, and never call
another tool's CLI: Antigravity's consumer terms forbid other agents running `agy`
(<https://antigravity.google/docs/faq/>), and the other providers' terms don't clearly allow it.

| Tool | Cheap tier |
| --- | --- |
| Claude Code | `haiku` |
| Codex | the newest Luna model (`codex exec -m <luna slug>`; slugs are in `~/.codex/models_cache.json`) |
| Antigravity | the newest Gemini Hydrogen model (`agy models` lists them) |

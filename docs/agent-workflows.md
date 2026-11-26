# Agent workflows

[Back to README](../README.md)

Paths below refer to your project. The kit's skills are installed with
`npx skills add TDrake44/drakom-ai-dev-kit`, at user level (`-g`) or project
level, where the `skills` CLI keeps its copies and a `skills-lock.json` in your
repository. The context below is yours to edit.

## The `.drakom-ai/` layout

`/drakom-ai-setup` (`$drakom-ai-setup` in Codex) writes the missing
`.drakom-ai/.gitignore`, `rules/README.md` and `specs/README.md`, then offers the
rest, writing each of those only on your yes:

```text
.drakom-ai/
├── .gitignore          # ignores plans/ and assets/
├── assets/             # local, ignored; made when first used
├── plans/              # local, ignored; made when first used
├── rules/
│   └── README.md       # topic rules and the extension files
└── specs/
    └── README.md       # tracked specifications

AGENTS.md               # offered when missing
CLAUDE.md               # left as it is when it already links to AGENTS.md
.worktreeinclude        # offered
```

| Path | Tracking | Role |
| --- | --- | --- |
| `.drakom-ai/plans/` | Local (gitignored) | Plans written by `drakom-plan` and worked from by `drakom-dev`, before and while code is written. |
| `.drakom-ai/specs/` | Tracked | Specifications and decisions elevated for review by others or for continuity across sessions. |
| `.drakom-ai/rules/` | Tracked | Project-owned rules, loaded only for the tasks they are routed to. |
| `.drakom-ai/assets/` | Local (gitignored) | Screenshots, mockups or logs an agent reads during a task. |
| `AGENTS.md` / `CLAUDE.md` | Tracked | The front door: routes each task to the rules it needs. |
| `.worktreeinclude` | Tracked | Copies the ignored plans and assets into new worktrees. |

Setup does not create generic `coding.md` or `testing.md` rules. It proposes a
rule only when repository evidence supports it, and writes it only after you
approve.

## Rules and extension files

`AGENTS.md` should route a task to only the rules that task needs, not hold every
project policy. A rule file in `.drakom-ai/rules/` is loaded when `AGENTS.md`,
`CLAUDE.md` or the "Topic rules" list in `.drakom-ai/rules/README.md` routes to
it.

Six names in `.drakom-ai/rules/` are optional extension files the skills find by
name, with no route. Each adds to a skill's steps and cannot switch one off:

| File | Read by | Holds |
| --- | --- | --- |
| `verification.md` | `drakom-dev`, `drakom-review`, `drakom-pr` | Commands to run before work counts as done, and manual checks. |
| `review.md` | `drakom-review`, `drakom-dev`, `drakom-pr` | What a review checks, and the cheap model tier for the blind risk check. |
| `plan.md` | `drakom-plan` | Steps a repo adds to planning. |
| `dev.md` | `drakom-dev` | Steps a repo adds to building a change. |
| `pr.md` | `drakom-pr` | Pull request habits, and the answer to the template offer. |
| `handoff.md` | `drakom-handoff` | What a handoff prompt adds. |

Without them, the skills use the commands and conventions in `AGENTS.md` or
`CLAUDE.md`, then their own defaults. To add, revise or retire a rule, run
`/drakom-ai-setup`; `/drakom-ai-setup audit` reports broken routes and duplicate
or conflicting rules without changing anything.

Your own skills stay yours. Don't name them with the `drakom-` prefix, which the
kit's skills use.

## Worktrees and parallel sessions (`.worktreeinclude`)

Git checks out only tracked files, so a fresh worktree starts without the
ignored `.drakom-ai/plans/` and `.drakom-ai/assets/`. The `.worktreeinclude` that
setup offers lists `.drakom-ai/plans/*` and `.drakom-ai/assets/*`:

- **Claude Code** reads it for worktrees it creates (`claude --worktree`) and
  copies the listed ignored files into them. So do Codex-managed worktrees in the
  ChatGPT desktop app, but not worktrees you create yourself with `git worktree`.
- Other worktree helpers, such as `git-worktreeinclude`, use the same file.
- Add other ignored files you want in every worktree, such as `.env`.

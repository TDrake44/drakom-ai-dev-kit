# Agent workflows

[Back to README](../README.md)

Paths below refer to the target project. Use the setup skill to review project-specific changes before applying them.

## What `init` Creates

For a fresh repository, `drakom-ai init .` creates:

```text
.drakom-ai/
├── .gitignore
├── mcp-servers.yaml              # omitted with --skip-mcp
├── state.json
├── assets/                       # ignored, initially empty
├── plans/                        # ignored, initially empty
├── rules/
│   └── README.md                 # explains project-specific rules
└── specs/
    └── README.md                 # explains tracked architecture specifications

.agents/
└── skills/
    ├── drakom-ai-setup/
    │   ├── SKILL.md
    │   └── references/
    │       ├── assessment-plan-template.md
    │       └── rule-anatomy.md
    ├── drakom-skill-author/
    │   ├── SKILL.md
    │   └── references/
    │       └── skill-patterns.md
    └── drakom-plan-audit/
        └── SKILL.md

.claude/
└── skills/                       # generated SKILL.md-only mirrors for Claude Code
    ├── drakom-ai-setup/SKILL.md
    ├── drakom-skill-author/SKILL.md
    └── drakom-plan-audit/SKILL.md

AGENTS.md
CLAUDE.md
.worktreeinclude
```

`init` refuses to replace a hand-authored `.claude/skills/` entry that shares a
kit skill's name; it reports a conflict and makes no changes. `init` mirrors only
the kit's skills. Run `drakom-ai sync .` to mirror skills your project already
has in `.agents/skills/`.

`init` does not create generic `coding.md`, `testing.md`, or other policy files. Those are project-owned decisions: `/drakom-ai-setup` recommends them only when repository evidence supports them and the project owner approves.

### Core Structure & Workflow Roles

| Directory / File | Tracking | Role in Workflow |
| --- | --- | --- |
| `.drakom-ai/plans/` | Local (gitignored) | Scratchpad planning for agent task breakdowns, checklists, and TDD loops before writing code. |
| `.drakom-ai/specs/` | Tracked (git) | Architecture specifications and RFCs elevated for team review and multi-session continuity. |
| `.drakom-ai/rules/` | Tracked (git) | Modular coding and testing standards loaded on-demand via `AGENTS.md` (preventing context bloat). |
| `.drakom-ai/assets/` | Local (gitignored) | Screenshots, mockups, or error logs referenced by agents during tasks. |
| `.agents/skills/` | Tracked (git) | Canonical, portable agent task procedures mirrored to `.claude/skills/` via `sync`. |
| `AGENTS.md` / `CLAUDE.md` | Tracked (git) | Front-door context hub and task router across all supported AI assistants. |
| `.worktreeinclude` | Tracked (git) | Preserves local gitignored AI context (`.drakom-ai/plans/*`, `.drakom-ai/assets/*`) across git worktrees. |

## How Rules and Skills Evolve

`AGENTS.md` is the front door. It should route a task to only the rules needed
for that task; it is not a place to paste every project policy. `CLAUDE.md`
imports that shared router so the two entry points stay aligned.

When a project needs to add, revise, rename, or retire a rule, run the setup
skill (`/drakom-ai-setup` or `$drakom-ai-setup`). After approval, it:

1. Creates the rule under `.drakom-ai/rules/`, following the anatomy and size
   budget in `.agents/skills/drakom-ai-setup/references/rule-anatomy.md`.
2. Adds a task-based link to the `AGENTS.md` Standards Index.
3. Revises stale routes when a rule is renamed or superseded.
4. Verifies links, commands, and relevant project checks.

Skills are procedures rather than policy. Author them in `.agents/skills/`; run
`drakom-ai sync .` to generate their Claude Code mirrors. The
`drakom-skill-author` skill (`/drakom-skill-author` or `$drakom-skill-author`)
manages project skills, and setup hands approved skill additions to it:

1. **Find**: proposes a candidate only from evidence of repeated work (git and
   pull request history, CI configuration, package scripts, contribution docs,
   plans and specs) or an explicit request.
2. **Write**: drafts a short skill that routes to rules instead of copying
   them, with stop points, verification commands, and a report.
3. **Check**: walks the draft through a recent real task and verifies its paths
   and commands.
4. **Refine or retire**: makes targeted fixes to stale or misfiring skills, or
   proposes removing unused ones.

It asks for approval before creating, changing, or removing any project skill.
Common archetypes and a worked example are in
`.agents/skills/drakom-skill-author/references/skill-patterns.md`.

A project may add, replace, or remove its own rules and skills—the kit does not
claim ownership of them. Kit-managed skills use the `drakom-` prefix
(`drakom-ai-setup`, `drakom-skill-author`, `drakom-plan-audit`); projects should
not name their own skills with that prefix, to avoid colliding with skills the
kit may add in the future.

## Git Worktrees and Parallel Sessions (`.worktreeinclude`)

When running parallel AI assistant sessions (e.g. `claude --worktree`, Codex-managed worktrees in the ChatGPT desktop app, or branch-isolated workspaces), Git only checks out tracked files. Because `.drakom-ai/plans/` and `.drakom-ai/assets/` are gitignored to keep scratchpad work local, fresh worktrees naturally start without that active context.

`drakom-ai init` scaffolds a project-owned `.worktreeinclude` file at the repository root:

- **Native Tool Support**: Recognized natively by **Claude Code** and by Codex-managed worktrees in the **ChatGPT desktop app** (not worktrees you create yourself with Git on the command line) to automatically copy specified gitignored files into newly created worktree directories.
- **Cross-Tool Standard**: Acts as the standard manifest for Git worktree helper utilities (like `git-worktreeinclude`), and custom checkout hooks.
- **Customizable & Project-Owned**: Pre-seeded with `.drakom-ai/plans/*` and `.drakom-ai/assets/*`. You can freely add other untracked files (such as `.env` or local databases) without triggering Drakom AI Dev Kit drift warnings.

See [synchronization and ownership](sync.md) for which files the kit manages.

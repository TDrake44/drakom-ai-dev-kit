# Drakom AI Dev Kit

[![npm version](https://img.shields.io/npm/v/@drakom/ai-dev-kit?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@drakom/ai-dev-kit)
[![npm downloads](https://img.shields.io/npm/dm/@drakom/ai-dev-kit?style=flat-square)](https://www.npmjs.com/package/@drakom/ai-dev-kit)
[![CI](https://img.shields.io/github/actions/workflow/status/TDrake44/drakom-ai-dev-kit/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/TDrake44/drakom-ai-dev-kit/actions)
[![license](https://img.shields.io/npm/l/@drakom/ai-dev-kit?style=flat-square)](LICENSE)

> A portable, tool-agnostic workflow system for high-leverage AI development.

I built this workflow for my own hobby development. Between a full-time job and family life, my time for personal projects is precious. AI assistants make it possible for me to keep building and shipping, but managing setup, context, and prompt drift across tools was eating into my limited coding hours.

I frequently bounce between **Claude Code**, **OpenAI Codex**, **Antigravity**, and **GitHub Copilot** depending on which memberships and quotas I have available at any given time. I didn't want vendor lock-in, but I also refused to manage configurations, rules, and skills in four different places.

**Drakom AI Dev Kit** is the packaged, portable version of the system I landed on:
- **Instant Portability**: Spawns a lightweight, predictable structure (`plans/`, `specs/`, `assets/`, `rules/`) into any new or existing project with a single command.
- **Zero Tool Lock-in**: Define agent rules and skills in one canonical place; sync scripts keep your tool-specific configs aligned automatically.
- **Lightweight & Modular**: Separates scratchpad thinking (`plans/`) from tracked architecture (`specs/`) and task-scoped rules without boilerplate bloat.

Because I use this daily across all my personal projects, it is a living system that I'll continue to refine and polish as my workflows and the AI tooling landscape evolve.

Drakom is an independently maintained open-source project brand.

## What It Does

| Capability | Purpose |
| --- | --- |
| Context scaffold | Creates an isolated `.drakom-ai/` namespace plus minimal `AGENTS.md` and `CLAUDE.md` entry points. |
| Rule governance | Uses `/drakom-ai-setup` (or `$drakom-ai-setup`) to assess a repository before proposing project-specific rules, then requires approval before creating them. |
| Task routing | Keeps `AGENTS.md` as the concise router from a task type to the relevant on-demand rules and skills. |
| Canonical skills | Stores portable agent skills in `.agents/skills/` and mirrors them to Claude Code under `.claude/skills/`. |
| MCP synchronization | Generates supported tool configuration from one `.drakom-ai/mcp-servers.yaml` registry. |
| Safe updates | Records managed-file fingerprints in `.drakom-ai/state.json` and reports drift or conflicts instead of overwriting local edits. |

## Quick Start

Use a one-time invocation to evaluate Drakom AI Dev Kit without adding it to the project:

```bash
# Using npx or pnpm dlx
npx @drakom/ai-dev-kit init .
# or
pnpm dlx @drakom/ai-dev-kit init .
```

Or install it as a development dependency for ongoing synchronization:

```bash
pnpm add -D @drakom/ai-dev-kit
pnpm drakom-ai init .
```

When initialization completes, open your preferred AI assistant and run the setup skill:

```text
/drakom-ai-setup    # Claude Code, Antigravity, GitHub Copilot
$drakom-ai-setup    # OpenAI Codex CLI
```

Interactive initialization also offers the optional `plan-audit` skill for
reviewing or cleaning up local `.drakom-ai/plans/`. To install it without the
interactive choice, pass `--with-plan-audit`; it is omitted by default from
`--yes` runs. The same flag can add the skill safely to an existing initialized
project. The skill is recorded as kit-managed and its Claude mirror is generated
by `drakom-ai sync`.

The agent will inspect your repository (tooling, scripts, directory structure), propose the smallest useful set of project-owned rules, create an approval-gated plan under `.drakom-ai/plans/`, and only make changes once you review and approve.

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
    └── drakom-ai-setup/
        ├── SKILL.md
        └── references/
            └── assessment-plan-template.md

AGENTS.md
CLAUDE.md
.worktreeinclude
```

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

1. Creates the rule under `.drakom-ai/rules/`.
2. Adds a task-based link to the `AGENTS.md` Standards Index.
3. Revises stale routes when a rule is renamed or superseded.
4. Verifies links, commands, and relevant project checks.

Skills are procedures rather than policy. Author them in `.agents/skills/`; run
`drakom-ai sync .` to generate their Claude Code mirrors. A project may add,
replace, or remove its own rules and skills—the kit does not claim ownership of
them.

## Managed and Project-Owned Content

| Managed by Drakom AI Dev Kit | Owned by the project |
| --- | --- |
| Setup skill and optional plan-audit skill installed by `init` | Rules in `.drakom-ai/rules/` |
| The managed block in `AGENTS.md` | Task routes and all other `AGENTS.md` content |
| Generated Claude skill mirrors | Project-authored canonical skills in `.agents/skills/` |
| Generated MCP client blocks | MCP registry choices and all unmanaged client configuration |
| Fingerprints in `.drakom-ai/state.json` | Plans, specifications, `.worktreeinclude`, and team decisions |

Managed content is updated only when its recorded fingerprint still matches.
If it has local edits, synchronization reports a conflict rather than replacing
it. Unmanaged content is preserved byte-for-byte.

## MCP Configuration

Declare MCP servers once in `.drakom-ai/mcp-servers.yaml` and synchronize them
into these repository-local client files:

- `.mcp.json` for Claude Code and GitHub Copilot CLI
- `.vscode/mcp.json` for VS Code Copilot
- `.agents/mcp_config.json` for Antigravity CLI
- `.codex/config.toml` for OpenAI Codex CLI

Variable references in commands, arguments, URLs, environment values, and
headers use each client's syntax. Claude Code receives `${VAR}` and VS Code
receives `${env:VAR}`. Codex maps whole environment and header references to
its environment-backed fields; other references require a Codex override.
Antigravity requires client-specific values for references it cannot expand.
Sync reports a conflict when a reference cannot be represented safely.

During initialization, Drakom AI Dev Kit compares discovered repository-local MCP
configuration with the registry and reports what it found, preserving unmanaged
definitions rather than adopting them automatically. Run the `drakom-ai-setup`
skill to walk through the reported decisions (import, import with overrides,
leave unmanaged, or skip) for each discovered server. Use `--skip-mcp` if the
project should not initialize MCP management.

## Git Worktrees and Parallel Sessions (`.worktreeinclude`)

When running parallel AI assistant sessions (e.g. `claude --worktree`, Codex CLI tasks, or branch-isolated workspaces), Git only checks out tracked files. Because `.drakom-ai/plans/` and `.drakom-ai/assets/` are gitignored to keep scratchpad work local, fresh worktrees naturally start without that active context.

`drakom-ai init` scaffolds a project-owned `.worktreeinclude` file at the repository root:

- **Native Tool Support**: Recognized natively by **Claude Code** and **OpenAI Codex CLI** to automatically copy specified gitignored files into newly created worktree directories.
- **Cross-Tool Standard**: Acts as the standard manifest for Git worktree helper utilities (like `git-worktreeinclude`), custom checkout hooks, and Antigravity workspace runners.
- **Customizable & Project-Owned**: Pre-seeded with `.drakom-ai/plans/*` and `.drakom-ai/assets/*`. You can freely add other untracked files (such as `.env` or local databases) without triggering Drakom AI Dev Kit drift warnings.

## CLI Reference

| Command | Effect |
| --- | --- |
| `drakom-ai --help` | Show command usage and available subcommands. |
| `drakom-ai init --help` | Show initialization options without inspecting or changing the target. |
| `drakom-ai sync --help` | Show synchronization options without inspecting or changing the target. |
| `drakom-ai init [path]` | Preview and interactively approve project initialization. The default path is `.`. |
| `drakom-ai init [path] --dry-run` | Render the initialization plan without changing files. |
| `drakom-ai init [path] --yes` | Apply safe initialization without a prompt; it refuses structured merges into existing entry points. |
| `drakom-ai init [path] --skip-mcp` | Initialize without creating the MCP registry or rendering an MCP comparison report. |
| `drakom-ai init [path] --with-plan-audit` | Install the optional local plan audit skill, including in an initialized project. |
| `drakom-ai sync [path] --dry-run` | Render managed updates, skill-mirror work, and MCP changes without applying them. |
| `drakom-ai sync [path]` | Apply safe managed updates and generate synchronized client configuration. |
| `drakom-ai sync [path] --check` | Exit nonzero when managed content, skill mirrors, or generated MCP configuration has drifted. |

## Lifecycle

1. Run `init` to establish the safe minimal scaffold.
2. Run `/drakom-ai-setup` (or `$drakom-ai-setup`) to assess the repository and approve project-owned rules or workflows.
3. Make changes through the project’s routed rules and canonical skills.
4. Run `sync` after kit updates or canonical-skill/MCP changes.
5. Use `sync --check` in CI to detect drift before it reaches contributors.

## Alternative Adoption Paths

- [BOOTSTRAP.md](BOOTSTRAP.md) is a standalone architecture blueprint for a manual adoption.
- A GitHub template repository can provide a preconfigured starting point.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm sync:check
```

## Requirements

- Package users: Node.js >= 24.
- Contributors and release automation require Node.js 24 LTS. Use `.nvmrc` with a compatible version manager; Changesets v3 requires Node.js >= 22.11.0.
- pnpm >= 10.15.0

## License

[MIT](LICENSE)

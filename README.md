# Drakom AI Dev Kit

[![npm version](https://img.shields.io/npm/v/@drakom/ai-dev-kit?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@drakom/ai-dev-kit)
[![npm downloads](https://img.shields.io/npm/dm/@drakom/ai-dev-kit?style=flat-square)](https://www.npmjs.com/package/@drakom/ai-dev-kit)
[![CI](https://img.shields.io/github/actions/workflow/status/TDrake44/drakom-ai-dev-kit/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/TDrake44/drakom-ai-dev-kit/actions)
[![license](https://img.shields.io/npm/l/@drakom/ai-dev-kit?style=flat-square)](LICENSE)

Keep project rules, agent skills and MCP server definitions in one place while
working with Claude Code, OpenAI Codex, Antigravity and GitHub Copilot.

I built this for my own hobby projects to spend less time maintaining duplicate
agent configuration. It scaffolds shared context, helps an agent propose useful
project-specific rules, and synchronizes supported client files.

## What it does

| Capability | How it helps |
| --- | --- |
| Shared context | `AGENTS.md` routes tasks to the project's rules and skills; `CLAUDE.md` imports it. |
| Project assessment | The setup skill recommends rules and workflows from repository evidence, with approval before changes. |
| Portable skills | Canonical skills live in `.agents/skills/`; sync generates Claude Code mirrors. |
| MCP configuration | One `.drakom-ai/mcp-servers.yaml` registry generates supported client configuration. |
| Safe updates | Sync tracks managed content, previews changes and reports conflicts for local edits. |

## Requirements

- Package users: Node.js >= 24.
- pnpm >= 10.15.0, or npm for one-time invocation.
- Contributors and release automation require Node.js 24 LTS. Use `.nvmrc` with a compatible version manager; Changesets v3 requires Node.js >= 22.11.0.

## Quick start

Install in your project for ongoing synchronization:

```bash
pnpm add -D @drakom/ai-dev-kit
pnpm drakom-ai init .
```

For one-time use:

```bash
npx @drakom/ai-dev-kit init .
```

After initialization, ask your AI assistant to run the setup skill:

```text
/drakom-ai-setup    # Claude Code, Antigravity, GitHub Copilot
$drakom-ai-setup    # OpenAI Codex CLI
```

It inspects the repository and proposes project-specific context for your
approval.

## Install the skills with `npx skills`

The kit's skills also install on their own with the
[`skills` CLI](https://github.com/vercel-labs/skills), which finds them in this
repository's `skills/` folder. For every project on your machine (user level):

```bash
npx skills add TDrake44/drakom-ai-dev-kit -g
npx skills update -g    # later, to update
```

For one project (project level), run it in that project without `-g`. The CLI
then keeps its copies and a `skills-lock.json` in the project.

Until 0.7.0, `drakom-ai-setup` still expects the CLI above for `init`, `sync`
and MCP, so use the Quick start for a full setup.

## Project layout

```text
.drakom-ai/
  rules/                 # Project-owned policies
  plans/                 # Local, ignored scratchpads
  specs/                 # Shared specifications and decisions
  mcp-servers.yaml       # MCP server registry
  state.json             # Kit-managed ownership records
.agents/skills/          # Canonical skills
.claude/skills/          # Generated Claude Code mirrors
AGENTS.md / CLAUDE.md    # Agent entry points
```

The [workflow guide](https://github.com/TDrake44/drakom-ai-dev-kit/blob/main/docs/agent-workflows.md)
covers the full scaffold, ownership and worktree behavior.

## Included skills

| Skill | When to use it |
| --- | --- |
| `drakom-ai-setup` | Assess a repository and propose project-specific rules and workflows for approval. |
| `drakom-dev` | Build one pull request's worth of work from a plan or a request, test first, then run the repo's checks, re-read the diff and report. Installed with `npx skills add` only, not by the CLI. |
| `drakom-handoff` | Write a prompt for a fresh session to pick up the next step, printed in the chat to copy. Installed with `npx skills add` only, not by the CLI. |
| `drakom-plan` | Turn a request into a plan file before any code: an interview on the open decisions, each with a recommended answer (`quick` skips it), and an offer to split it into smaller plans when the work outgrows one pull request. The interview is adapted from Matt Pocock's [`grilling`](https://github.com/mattpocock/skills) skill (MIT). Installed with `npx skills add` only, not by the CLI. |
| `drakom-plan-audit` | Review or clean up local plans when explicitly requested. |
| `drakom-pr` | Open a pull request on GitHub: a risk check from the diff alone, a description from the repo's template within its word budget (or a starter it offers once to add), and the link recorded in the plan; never merges, replies or resolves threads. Installed with `npx skills add` only, not by the CLI. |
| `drakom-review` | Review a branch or pull request with a blind risk check and a fresh reviewer, once or in up to three fix rounds (`fix`), and post the report to the pull request as one Copilot-style review (`post`, GitHub only). Installed with `npx skills add` only, not by the CLI. |

## Day-to-day use

Edit canonical skills in `.agents/skills/` and MCP definitions in
`.drakom-ai/mcp-servers.yaml`. After those edits or a kit update:

```bash
pnpm drakom-ai sync . --dry-run   # Preview changes
pnpm drakom-ai sync .            # Apply safe updates
pnpm drakom-ai sync . --check    # Check for drift, including in CI
```

Sync reports conflicts for local edits and can still apply unrelated updates.
A remaining conflict exits `2`. See the
[conflict guide](https://github.com/TDrake44/drakom-ai-dev-kit/blob/main/docs/sync.md#conflicts)
for keeping an edit or taking ownership of a managed file.

## Guides

| You want to… | Read |
| --- | --- |
| Choose MCP clients, configure overrides or handle credentials | [MCP configuration](https://github.com/TDrake44/drakom-ai-dev-kit/blob/main/docs/mcp.md) |
| Understand ownership, conflicts and CLI commands | [Synchronization](https://github.com/TDrake44/drakom-ai-dev-kit/blob/main/docs/sync.md) |
| Work with rules, skills, project structure or worktrees | [Agent workflows](https://github.com/TDrake44/drakom-ai-dev-kit/blob/main/docs/agent-workflows.md) |
| Update an existing installation | [Upgrading](https://github.com/TDrake44/drakom-ai-dev-kit/blob/main/docs/upgrading.md) |

See the [changelog](https://github.com/TDrake44/drakom-ai-dev-kit/blob/main/CHANGELOG.md) for release history and the
[security policy](https://github.com/TDrake44/drakom-ai-dev-kit/blob/main/SECURITY.md) for vulnerability reporting.

## Development

From a checkout of this repository:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm sync:check
```

## License

[MIT](LICENSE)

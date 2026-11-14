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
approval. The kit also installs skills for authoring project skills and auditing
local plans. It creates `.drakom-ai/` for rules, plans and specifications;
the [workflow guide](https://github.com/TDrake44/drakom-ai-dev-kit/blob/main/docs/agent-workflows.md) shows the full layout.

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

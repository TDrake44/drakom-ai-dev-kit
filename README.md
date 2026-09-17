# Drakom AI Dev Kit

Drakom AI Dev Kit is an opinionated, vendor-neutral starter kit for structuring
AI-assisted software development. Its pnpm-based reference implementation can
be adapted to other package managers, languages, and build systems.

## What This Is

This repository contains:

1. **[BOOTSTRAP.md](BOOTSTRAP.md)** — a standalone architecture blueprint that
   an AI coding assistant can adapt to an existing repository.
2. **A reference implementation** — a dogfooded example that can be cloned,
   copied, or used as a GitHub template.

The kit is intentionally small. It coordinates repository guidance and checks;
it does not replace your project's formatter, test runner, or application
architecture.

## The Five Structural Ideals

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Universal front door: AGENTS.md + CLAUDE.md                            │
│ 2. Declarative, on-demand policies: .ai/rules/                           │
│ 3. Procedural workflows: .agents/skills/*/workflow.md                    │
│ 4. Canonical skills with generated Claude mirrors                        │
│ 5. One MCP registry generating configuration for supported tools         │
└────────────────────────────────────────────────────────────────────────────┘
```

## Requirements

- Node.js 20.19 or newer
- pnpm 10 for the reference implementation

## Adopt It in Another Project

Choose the smallest path that meets the project’s needs. The architectural
files work on their own. The Node generators are optional conveniences for
projects that want one MCP registry and generated Claude skill mirrors.

| Need | Copy from this kit | Also configure |
| --- | --- | --- |
| Architecture only | Selected canonical context files and skills | Target-specific rules, commands, ignore entries, and `.worktreeinclude` |
| Architecture with generated mirrors and MCP files | The architecture files plus `scripts/`, `package.json` script entries, and `.github/workflows/verify.yml` as a reference | `js-yaml`, `smol-toml`, task scripts, CI, and generated-file ownership checks |

### Start with a fresh project

Download a checkout or source archive of this repository and set `KIT_DIR` to
its location. From the target project, copy only canonical files. For example:

```bash
KIT_DIR=../ai-framework-blueprint
cp "$KIT_DIR/AGENTS.md" "$KIT_DIR/CLAUDE.md" .
mkdir -p .ai/plans .ai/assets .agents/skills
touch .ai/plans/.gitkeep .ai/assets/.gitkeep
cp -R "$KIT_DIR/.ai/rules" "$KIT_DIR/.ai/specs" .ai/
cp "$KIT_DIR/.ai/mcp-servers.yaml" .ai/
cp "$KIT_DIR/.agents/skills/README.md" .agents/skills/
cp -R "$KIT_DIR/.agents/skills/plan" .agents/skills/
```

Repeat the final copy command for each skill you choose to adopt. The command
intentionally excludes local plans and assets, generated MCP configuration,
the ownership snapshot, the kit’s `package.json`, lockfile, CI workflow, and
`scripts/`. Add generators only through the optional-generator steps below.
Before using the copied hub, remove references in `AGENTS.md` to omitted skills
and generator commands, and replace its verification commands with the target
project’s commands. For architecture-only use with Claude, manually copy selected
`SKILL.md` files into `.claude/skills/<name>/` and keep those copies synchronized,
or adopt the mirror script below. Apply the ignore and worktree entries below
to fresh projects as well.

### Add it to an existing project

Before copying, inspect existing `AGENTS.md`, `CLAUDE.md`, `.ai/`,
`.agents/`, `.claude/`, `.codex/`, `.vscode/mcp.json`, `.mcp.json`, and CI
workflows. Merge the kit’s guidance into the project’s existing context hub and
keep the project’s commands and policies authoritative. Do not replace a
manifest, existing tool configuration, or workflow wholesale.

Copy only selected canonical files. Then tailor `.ai/rules/` to the real stack,
remove any starter skill the project will not use, and make every path mentioned
by `AGENTS.md` exist.

Add these entries to `.gitignore` if they are not already present:

```gitignore
# Local AI scratchpads and working assets
.ai/plans/*
!.ai/plans/.gitkeep
.ai/assets/*
!.ai/assets/.gitkeep
```

Add the following to `.worktreeinclude` when the project uses git worktrees;
merge with existing entries rather than replacing the file:

```text
.env
.env.*
.ai/plans/*
.ai/assets/*
```

### Optional: install the Node generators

Use this path only after copying `scripts/generate-mcp-configs.mjs` and
`scripts/sync-skill-mirrors.mjs` from a local kit checkout/archive. The scripts
require Node 20.19+ and pnpm 10 in this reference implementation. In a pnpm
project, install their parser dependencies without replacing the existing
manifest. For a fresh project without a manifest, run `pnpm init` first:

```bash
pnpm add -D js-yaml smol-toml
# Only if the target type-checks JavaScript:
pnpm add -D @types/js-yaml
```

Copy the scripts without copying any generated configuration or state:

```bash
mkdir -p scripts
cp "$KIT_DIR/scripts/generate-mcp-configs.mjs" "$KIT_DIR/scripts/sync-skill-mirrors.mjs" scripts/
```

Add the following *missing* entries to the target project’s `scripts` object.
If any names already exist, choose project-specific names and use those same
names in CI.

```json
{
  "mcp:gen": "node scripts/generate-mcp-configs.mjs",
  "mcp:check": "node scripts/generate-mcp-configs.mjs --check",
  "skills:sync": "node scripts/sync-skill-mirrors.mjs",
  "skills:check": "node scripts/sync-skill-mirrors.mjs --check",
  "verify:ai": "pnpm run mcp:check && pnpm run skills:check"
}
```

If `.ai/mcp-servers.yaml` is absent, create it with `servers: {}` before running MCP commands.
Run `pnpm skills:sync` first. Review the resulting `.claude/skills/` changes
before accepting them. A same-named hand-authored Claude skill causes sync to
stop before writing or deleting files; reconcile or rename that collision.
Differently named Claude-only skills are preserved. See
[MCP Configuration](#mcp-configuration) for the generated targets and ownership
requirements before running `pnpm mcp:gen`.

### CI wiring and validation

Ensure the existing pull request CI job installs dependencies with
`pnpm install --frozen-lockfile`, then add `pnpm verify:ai`. Keep the project’s established
lint, typecheck, and test commands in that job. Use
[.github/workflows/verify.yml](.github/workflows/verify.yml) as an example,
not a replacement workflow.

For the optional-generator path, validate in a clean working tree:

```bash
pnpm skills:sync
pnpm skills:check
pnpm mcp:gen
pnpm mcp:check
pnpm lint
pnpm typecheck
pnpm test
```

For a project without the optional generators, run its native lint, typecheck,
and test commands and confirm every path in `AGENTS.md` is present. This kit
does not claim end-to-end verification of every supported AI client; use each
client with its configured setup before depending on it in team work.

## MCP Configuration

Define project MCP servers once in `.ai/mcp-servers.yaml`. A complete example
covering local and remote servers is available at
[examples/mcp-servers.yaml](examples/mcp-servers.yaml).

`pnpm mcp:gen` produces:

| Consumer | Generated file |
| --- | --- |
| Claude Code and GitHub Copilot CLI | `.mcp.json` |
| GitHub Copilot in VS Code | `.vscode/mcp.json` |
| Antigravity CLI | `.agents/mcp_config.json` |
| OpenAI Codex CLI | `.codex/config.toml` |

Treat these generated outputs as shared configuration in an existing project.
Before the first generation, inspect and commit or otherwise back up the current
files. Generation creates a tracked `.ai/mcp-generation-state.json` ownership
snapshot; commit it with the YAML source and generated files. It lets later
generation, CI, and fresh clones distinguish kit-managed MCP entries from
project-owned configuration.

The generator preserves unrelated JSON configuration and unmanaged Codex
configuration. On initial adoption, an exactly matching same-named JSON MCP entry
is accepted; a differing one causes generation to stop before writing files.
Existing Codex server names that conflict with generated names are rejected.
Legacy Codex output migrates automatically only when the entire file exactly
matches what the current registry would have generated.
Reconcile that server in `.ai/mcp-servers.yaml`, or rename one of the entries,
then rerun generation. Do not hand-edit a managed server entry: change the YAML
source and regenerate. If a managed entry was edited directly, restore its
generated version before rerunning; transfer any desired changes into the YAML.
Because the state snapshot contains the same
configuration values needed for ownership checks, keep credentials out of the
registry and use each client’s environment or authentication mechanism.

Canonical environment and header values are emitted literally. Use them only
for non-secret configuration; configure credentials through each tool's own
environment or authentication mechanism. JSON targets can use native overrides
when their configuration shapes differ.

## Customize the Defaults

The bundled rules and skills are starting points, not framework requirements.

- Edit or remove rules in `.ai/rules/` to match the project's actual stack.
- Edit, replace, or remove skill directories under `.agents/skills/`.
- Keep `.agents/skills/` as the canonical skill location and run
  `pnpm skills:sync` after changing it.
- When removing a rule or skill, also remove references to it from `AGENTS.md`
  and from any remaining skills. The hub should only advertise files that
  exist.

The drift checks verify generated files, not whether a project adopted the
starter kit's particular workflow opinions.

## Development

```bash
pnpm lint
pnpm lint:fix
pnpm typecheck
pnpm test
```

Tests use Node's built-in test runner and isolated temporary directories. The
CI workflow runs linting, type checking, tests, and both drift checks.

## Project Status

This project is pre-1.0. The structure and generated configuration formats may
change as the supported tools evolve.

## License

[MIT](LICENSE)

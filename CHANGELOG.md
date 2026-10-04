# Changelog

## 0.4.0

### Minor Changes

- 3c37c85: The `drakom-ai-setup` skill and its assessment plan template now record each relevant context source under Keep, Refine, Add, or Omit with its evidence, ownership, rationale, destination or action, dependencies, approval status, and verification. Setup lists `.drakom-ai/plans/` and `.drakom-ai/specs/` explicitly, because search tools that honour `.gitignore` skip them, and states that Omit never means delete. A new rule-authoring reference, `.agents/skills/drakom-ai-setup/references/rule-anatomy.md`, describes the anatomy, size budget, and common types of project rules; `init` installs it, and `sync` adds it to existing installs. `init` output now lists the detected context source paths before the planned operations.
- af31fe1: A new kit-managed skill, `drakom-skill-author`, helps projects build their own skills after adoption. It finds candidates from repeated work in git and pull request history, CI configuration, package scripts, contribution docs, and plans. It drafts short skills that route to rules and include verification and approval points, checks each draft against a recent real task, and refines or retires skills that go stale. It asks for approval before creating or changing any project skill. A companion reference, `.agents/skills/drakom-skill-author/references/skill-patterns.md`, describes common skill archetypes and includes a worked example. `init` installs both files, and `sync` adds them to existing installs. The `drakom-ai-setup` skill now hands approved skill additions to `drakom-skill-author`, and the managed `AGENTS.md` block names the new skill.
- e238424: `sync` now installs default files that newer kit releases add, so existing projects receive them without re-running `init`. A new default is created only when the project's recorded kit version predates the release that introduced it and nothing already exists at its path. An unmanaged file at that path is reported as a conflict and nothing is written. A default you delete, together with its state entry, is not offered again. When the new file is a skill, its Claude mirror is generated in the same sync.

### Patch Changes

- 2f89a23: Add `drakom-ai --version` (`-V`), which prints the installed kit version. `init` and `sync` now stop with reinstall guidance, before planning or writing anything, when the packaged payload version does not match the package version.
- 860cfc5: Preserve comments and formatting in MCP client configuration files.
  
  - `.vscode/mcp.json` is now read as JSONC, so comments and trailing commas no longer make `sync` and `init` fail. `.mcp.json` and `.agents/mcp_config.json` remain strict JSON.
  - Sync no longer rewrites JSON MCP client files whose managed servers are unchanged. When managed servers do change, only those entries are edited and comments elsewhere are kept.

## 0.3.0

### Minor Changes

- 5f749eb: Improve MCP synchronization, variable handling, and repository scanning.
  
  - Prevent false conflicts when a managed server is removed from both its registry and client configuration; report registry errors and direct import decisions to the setup skill.
  - Translate variable references into supported client formats, map Codex secrets to environment-backed fields, and reject references unsupported by Codex or Antigravity.
  - Reject malformed variable references such as `${env:API-KEY}` or `$API-KEY` in the MCP registry instead of writing them unexpanded into client configs; credential detection and rendering now share one reference grammar.
  - Skip common build-output directories while scanning and treat repositories containing only `.git` metadata as fresh.
  
  Migration: Sync now reports conflicts for variable references that a configured client cannot expand. Move VS Code `${input:...}` prompts into `overrides.vscode`; use matching environment variable names for Codex passthrough; and move unsupported Codex or Antigravity references into client-specific overrides or supported environment-backed fields.
- 5f749eb: - Rename the optional `plan-audit` skill to `drakom-plan-audit`.
  - Existing 0.2.0 installs should remove the old skill and its `managedFiles` entry in `.drakom-ai/state.json`, then run `drakom-ai init --with-plan-audit`; sync reports a conflict until then.
  - Keep the `--with-plan-audit` flag unchanged.

## 0.2.0

### Minor Changes

- 7fc1e3e: Offer an optional local `plan-audit` skill during initialization and in existing projects. Clarify the setup, development, and PR review skills. Keep the packaged kit version aligned with package releases so older CLIs cannot overwrite newer managed content.

## 0.1.1

### Patch Changes

- 4e193b6: Add global and command-specific CLI help output.

## [0.1.0] - 2026-09-19

### Added

- Initial public release of `@drakom/ai-dev-kit`.

[0.1.0]: https://github.com/TDrake44/drakom-ai-dev-kit/releases/tag/v0.1.0

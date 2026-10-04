# Changelog

## 0.4.0

### Minor Changes

- af31fe1: **New skill: `drakom-skill-author`.** Helps your project create and maintain its own agent skills.
  - It suggests a skill only when work has repeated, found in git and pull request history, CI configuration, package scripts, contribution docs, or plans, or when you ask for one.
  - Drafts are short, use your project's name as a prefix, point to your rules instead of copying them, and include verification commands and approval points.
  - It tests each draft against a recent real task, and later fixes or retires skills that stop being useful.
  - It always asks before creating or changing a project skill.
  - Includes a reference of common skill types with a worked example (`references/skill-patterns.md`).
  - The setup skill now hands new skills to it.

- e238424: **`sync` adds new default files from newer releases.** Existing projects get files introduced in later versions without re-running `init`.
  - A file is added only if it is new since the version you have installed and nothing already exists at its path.
  - If something does exist there, `sync` reports a conflict and writes nothing.
  - If you delete a default file and remove its state entry, it is not added back.
  - New skills get their Claude mirror in the same run.

- 3c37c85: **Clearer project assessments and a guide for writing rules.**
  - The setup skill's assessment now records, for every existing context file: what it is, who owns it, what to do with it and why, what depends on it, whether it is approved, and how to verify it. "Omit" never means delete.
  - The setup skill now looks in `.drakom-ai/plans/` and `.drakom-ai/specs/` directly, because gitignore-aware search tools skip them.
  - New `rule-anatomy.md` explains how to structure a rule, how long it should be, and which kinds of rules are worth writing.
  - `init` now lists the existing context files it found before showing the planned changes.

### Patch Changes

- 2f89a23: **`drakom-ai --version`** (or `-V`) prints the installed version. `init` and `sync` now stop, without changing anything, if the installed package is internally inconsistent, and tell you to reinstall.
- 860cfc5: **MCP config files keep their comments and formatting.**
  - `.vscode/mcp.json` may now contain comments and trailing commas. `.mcp.json` and `.agents/mcp_config.json` must still be plain JSON.
  - `sync` no longer rewrites MCP config files when nothing it manages has changed. When something does change, only those entries are edited.

### Upgrading from 0.3.0

Update the package, then run `drakom-ai sync` once. It will:

- add the new `drakom-skill-author` skill, its `skill-patterns.md` reference, and its Claude mirror;
- add `rule-anatomy.md` next to the setup skill;
- update the setup skill and the managed block in `AGENTS.md`.

If you have edited any kit-managed file or the managed `AGENTS.md` block, or already have a file at one of the new paths, `sync` reports a conflict and changes nothing until you resolve it.

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

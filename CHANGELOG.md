# Changelog

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

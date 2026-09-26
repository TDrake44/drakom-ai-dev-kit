---
"@drakom/ai-dev-kit": minor
---

Improve MCP synchronization, variable handling, and repository scanning.

- Prevent false conflicts when a managed server is removed from both its registry and client configuration; report registry errors and direct import decisions to the setup skill.
- Translate variable references into supported client formats, map Codex secrets to environment-backed fields, and reject references unsupported by Codex or Antigravity.
- Reject malformed variable references such as `${env:API-KEY}` or `$API-KEY` in the MCP registry instead of writing them unexpanded into client configs; credential detection and rendering now share one reference grammar.
- Skip common build-output directories while scanning and treat repositories containing only `.git` metadata as fresh.

Migration: Sync now reports conflicts for variable references that a configured client cannot expand. Move VS Code `${input:...}` prompts into `overrides.vscode`; use matching environment variable names for Codex passthrough; and move unsupported Codex or Antigravity references into client-specific overrides or supported environment-backed fields.

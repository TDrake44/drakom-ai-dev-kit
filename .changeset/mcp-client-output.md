---
'@drakom/ai-dev-kit': minor
---

**Updated MCP output.** VS Code can use the shared root `.mcp.json`; `.vscode/mcp.json` remains available during its deprecation period. Antigravity uses `serverUrl` and `timeoutSeconds`. Codex blocks stay in place, preserve surrounding text and recognize inline/dotted server definitions.

Sync also preserves legacy Codex content, accepts entries already matching generated output, and rejects unsafe `__proto__` keys. See the [upgrade notes](https://github.com/TDrake44/drakom-ai-dev-kit/blob/main/docs/upgrading.md#upgrading-to-060) for shared-file exclusions and override changes.

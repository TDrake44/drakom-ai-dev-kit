---
"@drakom/ai-dev-kit": patch
---

Preserve comments and formatting in MCP client configuration files.

- `.vscode/mcp.json` may now contain comments, trailing commas, and a leading byte-order mark. Sync and `init` no longer report it as invalid, and its servers are discovered. `.mcp.json` and `.agents/mcp_config.json` remain strict JSON.
- JSON MCP client files whose managed servers are unchanged are no longer rewritten, so their comments, key order, indentation, and line endings stay exactly as written.
- When managed servers are added, updated, or removed, only those entries are edited. Unmanaged content and comments outside managed entries are kept, and new entries follow the file's indentation and line endings. Single-line content on lines an addition touches, or an entire minified file, may be reformatted.
- If a managed edit cannot be applied cleanly, for example because the file contains duplicate keys, sync reports a conflict and writes nothing.
- MCP server names that match built-in object properties, such as `constructor`, no longer crash sync, and an unmanaged `__proto__` server in a client file no longer causes false conflicts. A registry server named `__proto__` is now rejected with a clear error instead of being silently dropped.
- Adds `jsonc-parser` as a runtime dependency.

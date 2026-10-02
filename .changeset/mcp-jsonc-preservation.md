---
"@drakom/ai-dev-kit": patch
---

Accept comments, trailing commas, and a leading byte-order mark in `.vscode/mcp.json`, and apply managed MCP changes to JSON client files as minimal edits. Files whose managed servers are unchanged are no longer rewritten, so their comments and formatting are kept.

MCP server names that match built-in object properties, such as `constructor`, no longer crash sync, and an unmanaged `__proto__` server in a client file no longer causes false conflicts. A registry server named `__proto__` is now rejected with a clear error instead of being silently dropped.

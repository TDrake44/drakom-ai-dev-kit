---
"@drakom/ai-dev-kit": patch
---

Accept comments and trailing commas in `.vscode/mcp.json`, and apply managed MCP changes to JSON client files as minimal edits. Files whose managed servers are unchanged are no longer rewritten, so their comments and formatting are kept.

MCP server names that match built-in object properties, such as `constructor` or `__proto__`, are now handled like any other name instead of crashing sync or raising false conflicts.

---
"@drakom/ai-dev-kit": patch
---

Preserve comments and formatting in MCP client configuration files.

- `.vscode/mcp.json` is now read as JSONC, so comments and trailing commas no longer make `sync` and `init` fail. `.mcp.json` and `.agents/mcp_config.json` remain strict JSON.
- Sync no longer rewrites JSON MCP client files whose managed servers are unchanged. When managed servers do change, only those entries are edited and comments elsewhere are kept.

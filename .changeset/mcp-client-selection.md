---
'@drakom/ai-dev-kit': minor
---

**Before your first sync from 0.5:** Preview the changes with `pnpm drakom-ai sync . --dry-run`. If you previously used `init --skip-mcp`, an existing `.drakom-ai/mcp-servers.yaml` now enables MCP on the next sync. Remove the registry if MCP should stay off. Both `headers` and `http.headers` are checked for literal credentials. Use `${VAR}` references for those values. See the [0.6 upgrade guide](https://github.com/TDrake44/drakom-ai-dev-kit/blob/main/docs/upgrading.md#upgrading-to-060) for client-specific settings, line endings, and downgrade limits.

**Choose MCP clients.** Select clients with registry-level `clients` and per-server `skip`. Overrides can remove environment/header values with `null`; `notSecret` marks ordinary values without allowing token-shaped secrets.

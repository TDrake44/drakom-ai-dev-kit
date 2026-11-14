---
'@drakom/ai-dev-kit': minor
---

**Choose MCP clients.** Select clients with registry-level `clients` and per-server `skip`. Overrides can remove environment/header values with `null`; `notSecret` marks ordinary values without allowing token-shaped secrets. Adding a registry after `init --skip-mcp` now enables MCP on the next sync.

**Upgrade:** both header maps are now checked for literal credentials. Review the [0.6.0 upgrade notes](https://github.com/TDrake44/drakom-ai-dev-kit#upgrading-to-060) before syncing an existing project.

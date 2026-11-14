# Upgrading

[Back to README](../README.md)

## General workflow

To upgrade, update the package and run `drakom-ai sync .`. Sync updates
unmodified managed files and installs default files added in releases newer
than the recorded `kitVersion`, then records the installed kit version.
Kit-managed skills and their references are part of the kit; sync reports a
conflict if one is missing or edited (see [conflicts](sync.md#conflicts)). The recorded
`kitVersion` stays at the old release while a new default file cannot be
installed because an unmanaged file is in its place. Sync refuses to run when
the recorded `kitVersion` is newer than the installed kit.

## Upgrading to 0.6.0

Update the kit, preview with `pnpm drakom-ai sync . --dry-run`, then run
`pnpm drakom-ai sync .`. For one-time use, invoke the same commands through
`npx @drakom/ai-dev-kit`. Review these changes before applying the plan:

- **Local edits:** unrelated updates now proceed while conflicts remain;
  sync exits `2`. Use [accept or release](sync.md#conflicts) for edited managed files.
  Use one kit version across your team: older CLIs may drop release records
  from state and report accepted edits as conflicts.
- **MCP enablement:** a registry left behind after `init --skip-mcp` now enables
  MCP on sync. Remove `.drakom-ai/mcp-servers.yaml` if MCP should stay disabled.
- **Credentials:** both `headers` and `http.headers` are checked. Replace
  literal credentials with `${VAR}` references; `notSecret` cannot bypass
  token-shaped secret checks.
- **VS Code:** review the [shared root MCP rules](mcp.md#vs-code-and-the-root-mcpjson).
  `skip: [claude]` excludes a server from the root file; differing VS Code
  overrides and `${input:...}` prompts may apply only to `.vscode/mcp.json`.
  That legacy file is still generated until a later kit release removes it;
  VS Code's Local harness is scheduled for removal in February 2027.
- **Antigravity:** use `overrides.antigravity.timeoutSeconds` for timeouts.
  Legacy `type`, `transport` and `timeout` overrides are ignored with warnings;
  sync rewrites existing generated entries to the supported fields.
- **Line endings:** sync migrates matching old fingerprints automatically.
  Arbitrary old mixed endings cannot be reconstructed after the original bytes
  change, so unmatched records remain conflicts. Older CLIs that hash raw CRLF
  bytes may report conflicts after a downgrade. Text outside replaced sections
  keeps its existing endings.
- **Starter READMEs:** existing rules/specs READMEs are project-owned and stay
  as they are. Their new template guidance is installed only in fresh projects.

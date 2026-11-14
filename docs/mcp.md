# MCP configuration

[Back to README](../README.md)

Declare MCP servers once in `.drakom-ai/mcp-servers.yaml` and synchronize them
into these repository-local client files:

- `.mcp.json` for Claude Code, GitHub Copilot CLI and VS Code
- `.vscode/mcp.json` for VS Code's Local harness (deprecated, see below)
- `.agents/mcp_config.json` for Antigravity CLI
- `.codex/config.toml` for OpenAI Codex CLI

`.vscode/mcp.json` is read as JSONC, so it may contain comments and trailing
commas. `.mcp.json` and `.agents/mcp_config.json` must be strict JSON.

Codex and GitHub Copilot CLI load project-level MCP configuration only in
folders you have marked as trusted.

Antigravity receives the fields its MCP documentation defines: `command`,
`args` and `env` for a local server, `serverUrl` and `headers` for a remote one
(remote servers must use Streamable HTTP), and `timeoutSeconds` for either. Set
the timeout with `overrides.antigravity.timeoutSeconds`, in seconds. Earlier
releases also wrote `transport` and `timeout`, which Antigravity does not
define; `overrides.antigravity.type`, `transport` and `timeout` are still
accepted, are no longer written, and `sync` lists a `WARNING` row for each
server that sets them.

## VS Code and the root `.mcp.json`

VS Code's Copilot harness reads the workspace-root `.mcp.json`, in the same
format Claude Code uses. `.vscode/mcp.json` belongs to VS Code's Local harness,
which is deprecated and will be removed in February 2027; a later release of
the kit will stop generating `.vscode/mcp.json`. Until then:

- `.mcp.json` is written when `clients` includes `claude` or `vscode`. A server
  goes into it when it is generated for either of them, unless it has
  `skip: [claude]`: Claude Code reads `.mcp.json`, so such a server stays out of
  it, goes to `.vscode/mcp.json` only, and `sync` lists a `WARNING` row because
  VS Code's Copilot harness will not see it from `.mcp.json`.
- `.mcp.json` holds one version of each server. When both clients are
  selected and `overrides.claude` and `overrides.vscode` give different
  results, it holds the claude version, and `sync` lists a `WARNING` row: the
  vscode override for that server only applies to `.vscode/mcp.json`. Without
  `claude`, `.mcp.json` holds the vscode version.
- A server that uses a `${input:...}` prompt for VS Code cannot be written to
  `.mcp.json`. It goes to `.vscode/mcp.json` only, with a `WARNING` row.
- `.vscode/mcp.json` is still written for `vscode`, as before.

To stop generating `.vscode/mcp.json` today, select `claude` and leave `vscode`
out of `clients` (for example `clients: [claude, codex]`). VS Code then reads
the claude version of each server from `.mcp.json`; `overrides.vscode` and
`${input:...}` prompts are not used anywhere. There is no key that keeps
`vscode` selected but drops `.vscode/mcp.json`.

Variable references in commands, arguments, URLs, environment values, and
headers use each client's syntax. Claude Code receives `${VAR}` and VS Code
receives `${env:VAR}`. Codex maps whole environment and header references to
its environment-backed fields; other references require a Codex override.
Antigravity cannot expand references at all: skip it for that server, or remove
the field for it (both are described below). Sync reports a conflict when a
reference cannot be represented safely.

## Choosing clients

By default every server is generated for all four clients. Two optional keys
narrow that:

```yaml
clients: [claude, vscode, codex]   # registry root; omit it to use all four
servers:
  github:
    http:
      url: https://mcp.example.com/github
      headers:
        Authorization: "Bearer ${GITHUB_TOKEN}"
    skip: [antigravity]            # do not generate this server for these clients
```

- `clients` is a non-empty list of `claude`, `vscode`, `antigravity`, `codex`,
  without repeats. The kit does not generate a file for a client that is left
  out, and that client's file is never a conflict, whether it exists, is
  missing, or is invalid. The shared `.mcp.json` is the exception: it belongs
  to both `claude` and `vscode`, so it is generated, and can be a conflict,
  while either of them is selected.
- `skip` leaves one server out of the listed clients. It may name a client that
  `clients` already leaves out. A server that skips every selected client is an
  error; remove the server instead.
- A server is recorded in `state.json` only for the client files it is
  generated into.

When a server stops being generated for a client (through `clients` or `skip`)
and the kit had written it into that client's file:

| The entry in the client file | What `sync` does |
| --- | --- |
| Is still what the kit wrote | Removes that entry and stops tracking it. |
| Was edited | Leaves it, stops tracking it, and lists a `WARNING` row. In `.codex/config.toml` the entry moves out of the managed block: its tables, and comment lines directly above a table header, are kept as written; its position in the file and blank lines around it may change. |
| Is gone, or the file is gone or unreadable | Stops tracking it. |

The kit never deletes a client file and never touches servers it did not write.
A file it created can therefore be left with an empty server list (for
`.codex/config.toml`, without the managed block); delete it if you do not need
it. A client file you deleted on purpose stops being a conflict once its client
is left out of `clients`.

## Overrides

`overrides.<client>` changes a server for one client. `env` and `headers` (also
`http.headers`) are merged into the base server's values. Set a key to `null`
to remove it for that client, or set the whole map to `null` to remove all of
it:

```yaml
servers:
  api:
    command: node
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      LOG_LEVEL: info
    overrides:
      antigravity:
        env:
          GITHUB_TOKEN: null   # Antigravity gets LOG_LEVEL only
      codex:
        env: null              # Codex gets no env at all
```

`null` is only valid inside `overrides`.

## Literal credentials

`sync` refuses a registry that holds a literal credential, because the registry
and the generated files are committed. A value is refused when:

- its `env` or URL parameter name contains a credential word (`API_KEY`,
  `APIKEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `AUTH`, `CREDENTIAL`,
  `CREDENTIALS`, `JWT`, `PRIVATE_KEY`) as a whole underscore-separated part,
  unless the name ends in a part that only describes one: `MODE`, `TYPE`,
  `METHOD`, `SCHEME`, `PROVIDER`, `URL`, `URI`, `ENDPOINT`, `FILE`, `PATH`,
  `DIR`, `NAME`, `ENABLED`, `TTL`, `TIMEOUT`. So `GITHUB_TOKEN`, `AUTH` and
  `DB_PASSWORD` are refused; `AUTH_MODE`, `TOKEN_URL` and `PASSWORD_FILE` are
  not;
- its header is `Authorization`, `Api-Key`, `X-Api-Key`, `Token`, `Auth` or
  `X-Auth-Token`;
- the value looks like a token (`sk-…`, `ghp_…`, `gho_…`, `glpat-…`, `xox…`);
- the server's own URL carries a user name or password;
- the name contains a credential word, or is one of those headers, and the
  value is a URL carrying credentials before the host (`user:pw@host`, with or
  without a scheme) or a query parameter named like a credential
  (`?token=…`). A descriptive ending does not excuse this, so
  `AUTH_URL: https://host/x?token=…` is refused.

URL credentials in an `env` value under any other name are not detected:
`DATABASE_URL: postgres://user:pw@host/db` passes, so keep such values in a
`${VAR}` reference yourself. In an override, `headers` and `http.headers` are
both checked.

A `${VAR}` reference is always accepted. The conflict names the field, for
example `env.AUTH`. If that value is not a secret, list the path exactly as
printed under the server's `notSecret`:

```yaml
servers:
  api:
    command: node
    env:
      AUTH: basic
    notSecret: [env.AUTH, overrides.codex.env.AUTH]
    overrides:
      codex:
        env:
          AUTH: digest   # a separate field, so it has its own path
```

- `notSecret` accepts `env.NAME` and `headers.NAME`, and
  `overrides.<client>.env.NAME` and `overrides.<client>.headers.NAME` for a
  value set in an override. Each path covers that one field only.
- It switches off the name check only. A token-shaped value, or a URL value
  carrying credentials as described above, is refused even when its field is
  listed.
- A path that matches no field of the server is an error, so a typo is caught.

## Initialization

During initialization, Drakom AI Dev Kit compares discovered repository-local MCP
configuration with the registry and reports what it found, preserving unmanaged
definitions rather than adopting them automatically. Run the `drakom-ai-setup`
skill to walk through the reported decisions (import, import with overrides,
leave unmanaged, or skip) for each discovered server. Use `--skip-mcp` if the
project should not initialize MCP management.

To turn MCP management on later, create `.drakom-ai/mcp-servers.yaml` (an empty
`servers: {}` is enough) and run `drakom-ai sync`. The plan then includes MCP
generation and sets `features.mcp` to `true` in `state.json`; `sync --check`
reports this as drift until it is applied. Without that file, a `--skip-mcp`
project stays as it is.

This also applies on upgrade: a project initialized with `--skip-mcp` that
already has `.drakom-ai/mcp-servers.yaml` has MCP turned on by its next `sync`
with this version, and `sync --check` reports drift until then. To keep MCP
off, remove the registry file.

See [upgrade notes](upgrading.md#upgrading-to-060) before syncing an older project.

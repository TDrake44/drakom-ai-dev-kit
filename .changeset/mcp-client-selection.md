---
'@drakom/ai-dev-kit': minor
---

Let the MCP registry choose its clients, and make three MCP dead ends passable. Existing registries generate the same files and state as before.

- `clients:` at the registry root limits generation to the listed clients, and `skip:` on a server leaves that server out of the listed clients. A server that uses `${VAR}` can now be managed by skipping Antigravity, and a client file you do not use is no longer a conflict once its client is left out. When a server stops being generated for a client, `sync` removes the entry it wrote if it is unchanged, and otherwise leaves it and lists a `WARNING`.
- In `overrides.<client>`, a `null` value removes an `env` or `headers` key for that client, and `env: null` or `headers: null` removes the whole map.
- The literal-credential check no longer refuses names that only describe a credential, such as `AUTH_MODE`, `TOKEN_URL` or `PASSWORD_FILE`. `notSecret:` on a server lists fields that hold plain values, and the conflict message names both ways out. Token-shaped values and URL credentials are still always refused.
- After `init --skip-mcp`, creating `.drakom-ai/mcp-servers.yaml` and running `sync` turns MCP management on.

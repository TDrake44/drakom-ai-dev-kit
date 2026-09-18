# Drakom AI Dev Kit

Drakom AI Dev Kit is an opinionated, vendor-neutral starter kit for structuring
AI-assisted software development. It automates deterministic context scaffolding,
MCP server synchronization across AI developer tools, and canonical skill mirroring.

Drakom is an independently maintained open-source project brand.

## Quick Start

Choose between a one-time evaluation or ongoing synchronization:

### 1. One-Time Evaluation

Evaluate the kit in a fresh or existing repository without adding a package dependency:

```bash
pnpm dlx @drakom/ai-dev-kit init .
```

### 2. Ongoing Synchronization (Recommended)

Add `@drakom/ai-dev-kit` as a development dependency to keep project AI context, MCP
registries, and skill mirrors synchronized over time:

```bash
# Install as a dev dependency
pnpm add -D @drakom/ai-dev-kit

# Initialize project context scaffolding
pnpm drakom-ai init .
```

After initialization, the CLI instructs:

```text
Ask your coding agent to use $drakom-ai-setup to assess this repository.
```

### 3. Updating and Synchronizing

When kit updates are released, preview and apply updates:

```bash
# Update to latest version
pnpm update @drakom/ai-dev-kit

# Preview managed updates and drift without making changes
pnpm drakom-ai sync . --dry-run

# Apply managed updates and synchronize tool configurations
pnpm drakom-ai sync .
```

Verify that repository configurations are clean and up to date:

```bash
pnpm drakom-ai sync . --check
```

---

## Adoption Behavior

`drakom-ai init` is safe, collision-resistant, and non-destructive:

- **Isolated Namespace**: Project context is placed in `.drakom-ai/` rather than a generic folder, avoiding collisions with pre-existing tool configuration.
- **Managed Assessment Skill**: Installs `.agents/skills/drakom-ai-setup/SKILL.md` to evaluate repository manifests, CI, and tools before recommending rules or workflows.
- **Interactive Approval for Existing Projects**: When `AGENTS.md` or `CLAUDE.md` already exists, `drakom-ai init` displays a structured operation preview and prompts for explicit approval before appending a minimal, non-destructive routing block.
- **Unmanaged File Preservation**: Unrelated rules, custom skills, and existing MCP server definitions are preserved byte-for-byte.
- **Idempotent**: Repeated initialization on an initialized project is a safe no-op.

---

## Alternative Adoption Paths

- **[BOOTSTRAP.md](BOOTSTRAP.md)**: A standalone, self-contained architecture blueprint that an AI coding assistant or engineer can follow to manually bootstrap the pattern without the CLI.
- **GitHub Template Repository**: Clone or create a new GitHub repository from this template for a pre-configured starter project.

---

## How It Works: The Five Structural Ideals

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Universal front door: AGENTS.md + CLAUDE.md                            │
│ 2. Declarative, on-demand policies: .drakom-ai/rules/                       │
│ 3. Procedural workflows: .agents/skills/*/workflow.md                    │
│ 4. Canonical skills with generated Claude mirrors                        │
│ 5. One MCP registry generating configuration for supported tools         │
└─────────────────────────────────────────────────────────────────────────────┘
```

1. **Front Door**: `AGENTS.md` provides task routing and key verification commands. `CLAUDE.md` imports `@AGENTS.md` to maintain a single source of truth.
2. **On-Demand Rules**: Specific policies (e.g. coding standards, testing quality bars) are loaded only when the active task requires them.
3. **Canonical Skills**: Skills defined in `.agents/skills/` are mirrored automatically into `.claude/skills/` via `drakom-ai sync`.
4. **Unified MCP Registry**: Configure servers once in `.drakom-ai/mcp-servers.yaml`. `drakom-ai sync` generates configuration for:
   - Claude Code / GitHub Copilot CLI (`.mcp.json`)
   - VS Code Copilot (`.vscode/mcp.json`)
   - Antigravity CLI (`.agents/mcp_config.json`)
   - OpenAI Codex CLI (`.codex/config.toml`)
5. **State Tracking**: Tracked state in `.drakom-ai/state.json` records SHA-256 fingerprints to safely update kit-managed files while detecting local modifications and conflicts.

---

## Compatibility Window

For existing repositories adopting the kit, the legacy standalone generators remain functional during the compatibility window:
- `scripts/generate-mcp-configs.mjs` (`pnpm mcp:gen`, `pnpm mcp:check`)
- `scripts/sync-skill-mirrors.mjs` (`pnpm skills:sync`, `pnpm skills:check`)

---

## Development & Testing

```bash
# Linting
pnpm lint

# Type checking
pnpm typecheck

# Full test suite (unit tests and hermetic packed-artifact smoke tests)
pnpm test

# Workspace dogfooding drift check
pnpm sync:check
```

## Requirements

- Node.js >= 20.19.0
- pnpm >= 10.15.0

## License

[MIT](LICENSE)

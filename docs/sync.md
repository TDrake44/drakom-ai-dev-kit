# Synchronization and ownership

[Back to README](../README.md)

Commands below use `drakom-ai` as shorthand: run `pnpm drakom-ai` when installed locally, or `npx @drakom/ai-dev-kit` for one-time use. Paths refer to the target project.

## Managed and Project-Owned Content

Managed by Drakom AI Dev Kit:

- `drakom-ai-setup` skill and its references (`assessment-plan-template.md`, `rule-anatomy.md`)
- `drakom-skill-author` skill and its reference (`skill-patterns.md`)
- `drakom-plan-audit` skill
- The managed block in `AGENTS.md`
- Generated Claude skill mirrors
- Generated MCP client blocks
- Fingerprints in `.drakom-ai/state.json`

Owned by the project:

- Rules in `.drakom-ai/rules/`
- The starter `README.md` files in `.drakom-ai/rules/` and `.drakom-ai/specs/`:
  `init` creates each once if it is absent. They are not recorded in
  `state.json`, and `sync` never updates, checks, or recreates them, so edit or
  delete them freely.
- Task routes and all other `AGENTS.md` content
- Project-authored canonical skills in `.agents/skills/`
- MCP registry choices and all unmanaged client configuration
- Plans, specifications, `.worktreeinclude`, and team decisions

Managed content is updated only when its recorded fingerprint still matches.
If it has local edits, synchronization reports a conflict rather than replacing
it. Files with no managed changes are left untouched. Files with managed
changes are edited minimally: unmanaged content and comments outside managed
entries are kept. Single-line content on the lines an edit touches, or an
entire minified file, may be reformatted.

### Conflicts

A conflict holds back only its own item. `sync` still applies every other
update and records it in `state.json`, leaves the conflicting file and its
record exactly as they were, and exits `2` until the conflict is resolved. Two
exceptions are deliberately wider:

- An MCP conflict holds back all generated MCP client files, because each
  server's record spans every client file.
- The Claude mirror of a kit skill is left alone while that skill is in conflict.

Each conflict row names its next step. For an edited or deleted kit-managed
file, choose one:

| You want | Do this |
| --- | --- |
| The kit's version back | Restore the file (from Git, or from `payload/v1/` in the installed package) and run `drakom-ai sync`. |
| To keep your edit and stay managed | `drakom-ai sync --accept <path>` |
| To own the file yourself | `drakom-ai sync --release <path>` |

- `--accept` records your version (`acceptedFingerprint`) next to the kit's
  current version of that file. Your edit is kept, is not drift, and is never
  overwritten. When a later kit release changes that file, `sync` reports a
  conflict again so you can merge the kit's changes and accept again. Only a
  file with a local edit can be accepted: not a missing file, and not one that
  is merely behind the kit version.
- `--release` moves the file from `managedFiles` to `releasedFiles` in
  `state.json` and leaves the file alone. It also works for a managed file you
  deleted on purpose. The kit never updates or recreates a released file.
- A kit CLI older than 0.6.0 does not know either record. It reports an accepted
  file as a locally modified conflict and does not overwrite it. If it writes
  `state.json`, it drops `releasedFiles`, so use one kit version across a team.
- Both options are repeatable, apply to kit-managed files only (not skill
  mirrors, the `AGENTS.md` block, or MCP client files), and take paths relative
  to the target as printed in the plan. Any other path is an error.
- With `--dry-run`, both are previewed and nothing is written. They cannot be
  combined with `--check`.

A kit file that is present but not managed, and differs from the kit's version,
is listed as a `WARNING` row. This is what a released file looks like. A
warning is not drift and does not change the exit code.

## CLI Reference

| Command | Effect |
| --- | --- |
| `drakom-ai --help` | Show command usage and available subcommands. |
| `drakom-ai --version` (`-V`) | Print the installed kit version. |
| `drakom-ai init --help` | Show initialization options without inspecting or changing the target. |
| `drakom-ai sync --help` | Show synchronization options without inspecting or changing the target. |
| `drakom-ai init [path]` | Preview and interactively approve project initialization. The default path is `.`. |
| `drakom-ai init [path] --dry-run` | Render the initialization plan without changing files. |
| `drakom-ai init [path] --yes` | Apply safe initialization without a prompt; it refuses structured merges into existing entry points. |
| `drakom-ai init [path] --skip-mcp` | Initialize without creating the MCP registry or rendering an MCP comparison report. To turn MCP on later, create `.drakom-ai/mcp-servers.yaml` and run `sync`. |
| `drakom-ai sync [path] --dry-run` | Render managed updates, skill-mirror work, and MCP changes without applying them. |
| `drakom-ai sync [path]` | Apply safe managed updates and generate synchronized client configuration. A conflict holds back only its own item. |
| `drakom-ai sync [path] --check` | Exit nonzero when managed content, skill mirrors, or generated MCP configuration has drifted. |
| `drakom-ai sync [path] --accept <path>` | Keep a local edit to a kit-managed file until a later kit release changes that file. Repeatable. |
| `drakom-ai sync [path] --release <path>` | Stop managing a kit-managed file and leave it as it is. Repeatable. |

`sync` exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Everything is synchronized, or `--check` found no drift. |
| `1` | The command could not run, for example an invalid option or path. |
| `2` | A conflict remains (other changes may have been applied), or `--check` found drift. |

## Lifecycle

1. Run `init` to establish the safe minimal scaffold.
2. Run `/drakom-ai-setup` (or `$drakom-ai-setup`) to assess the repository and approve project-owned rules or workflows.
3. Make changes through the project’s routed rules and canonical skills.
4. Run `sync` after kit updates or canonical-skill/MCP changes.
5. Use `sync --check` in CI to detect drift before it reaches contributors.

## Versions

| Version | Meaning |
| --- | --- |
| Your application's version | Never changed by the kit, and unrelated to the versions below. |
| Installed kit version | The `@drakom/ai-dev-kit` package in use; print it with `drakom-ai --version`. |
| `kitVersion` in `.drakom-ai/state.json` | The last kit release successfully applied to the project by `init` or `sync`. |
| `schemaVersion` | The format of `state.json` and the packaged payload. It changes independently of kit releases. |

For package updates and version-specific caveats, see [upgrading](upgrading.md).

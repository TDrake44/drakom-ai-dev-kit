# Canonical Agent Skills

The `plan`, `dev`, `pr-review` and `document` folders are this repository's own hand-authored skills, in the open [agent-skills](https://agentskills.io) `SKILL.md` format. The `drakom-*` folders are installed copies of `payload/v1/skills/`: edit the payload and run `pnpm sync`, because sync treats a direct edit here as a conflict.

The included skills are defaults, not required framework components. A project
may edit, replace, or delete them. After removing a skill, update `AGENTS.md`
and any references from remaining skills, then run the synchronization command
to remove its generated Claude mirror.

This format is read natively by:
- VS Code GitHub Copilot
- GitHub Copilot CLI
- Antigravity CLI
- OpenAI Codex CLI

Claude Code does not read this directory directly; it reads the **generated mirror** at `.claude/skills/`.

## Synchronization
After creating or editing any skill here:
```bash
pnpm sync        # Regenerate the .claude/skills mirror
pnpm sync:check  # Verify consistency (used in CI)
```

The sync script only manages Claude mirrors marked with its generated notice. It
preserves any Claude-only skill that is authored directly in `.claude/skills/`.
If a canonical skill name already belongs to a hand-authored Claude skill, sync
stops before changing any mirrors. Rename or remove that Claude skill first.
When a canonical skill is removed, sync removes only its generated `SKILL.md`;
other files in that Claude skill directory remain in place.

## Authoring Standards

1. **Folder & Name Matching**: The YAML frontmatter `name` must match the directory name exactly (e.g. `plan/SKILL.md` has `name: plan`).
2. **Path References**: Rule and workflow files referenced in the reading list must use repository-root relative paths (e.g. `.drakom-ai/rules/coding.md`, `.agents/skills/plan/workflow.md`).
3. **Single-Copy Workflows**: A skill with a procedural recipe co-locates `workflow.md` next to `SKILL.md`. Supporting files are not mirrored to `.claude/skills/`; only `SKILL.md` is mirrored, and it points back to the single canonical `workflow.md`.

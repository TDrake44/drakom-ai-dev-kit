# Changelog

## 0.7.0

This is the last entry in this file. Later versions are described in [GitHub Releases](https://github.com/TDrake44/drakom-ai-dev-kit/releases).

0.7.0 retires the `drakom-ai` CLI, its MCP config generation and the npm package `@drakom/ai-dev-kit`. The kit is now its skills, installed with `npx skills add TDrake44/drakom-ai-dev-kit -g` (user level) or without `-g` (project level).

### Cleanup for repos on the CLI-era kit

Run this once in each repo that used `drakom-ai init` or `sync`. The kit wrote into files you may also have edited, so remove only what the kit wrote and keep everything of yours. Where a file, block or command mixes the two, remove just the kit's part. Keep `.drakom-ai/state.json` until the end: its records list the files, skill copies, `AGENTS.md` block and MCP servers the kit managed, and `git log -p -- <path>` shows what changed since. [Managed and project-owned content](https://github.com/TDrake44/drakom-ai-dev-kit/blob/v0.6.0/docs/sync.md#managed-and-project-owned-content) in the 0.6.0 guide gives the full ownership rules. Remove the kit's part of each of these:

1. The kit's skills, `drakom-ai-setup`, `drakom-plan-audit` and any `drakom-skill-author`, under `.agents/skills/` and `.claude/skills/`, and `.agents/skills/README.md`. Generated Claude copies of your own skills carry a `GENERATED MIRROR` comment and no longer update: delete them, or remove the comment and keep them by hand.
2. The `<!-- drakom-ai:start -->` … `<!-- drakom-ai:end -->` block in `AGENTS.md`.
3. `drakom-ai` and `npx @drakom/ai-dev-kit` commands in CI and `package.json` scripts, such as `drakom-ai sync --check`, and `@drakom/ai-dev-kit` in `devDependencies`.
4. `.drakom-ai/mcp-servers.yaml` and the servers the kit wrote into `.mcp.json`, `.vscode/mcp.json`, `.agents/mcp_config.json` and the `# BEGIN Drakom AI Development Context MCP servers` block in `.codex/config.toml`.
5. `.drakom-ai/state.json`, last.

Review `git diff` before you commit, then install the skills with `npx skills add TDrake44/drakom-ai-dev-kit -g`. Keep `.drakom-ai/rules/`, `.drakom-ai/plans/`, `.drakom-ai/specs/`, `.drakom-ai/assets/` and any `@AGENTS.md` line in `CLAUDE.md`, and run `/drakom-ai-setup` afterwards to add what the skills now expect.

### Minor Changes

- 93d0d63: Reworks the `drakom-ai-setup` skill for installs with `npx skills add TDrake44/drakom-ai-dev-kit`, with no CLI. It starts by creating the missing scaffold in `.drakom-ai/`, which consists of `.gitignore`, `rules/README.md` and `specs/README.md`. It skips and reports writes through symlinks. The rules README says any rule file can go in `.drakom-ai/rules/`, keeps an empty "Topic rules" list for routing them, and describes the six optional extension files the skills find by name (`verification.md`, `review.md`, `plan.md`, `dev.md`, `pr.md` and `handoff.md`).

  Setup asks before applying its offers and never commits. It offers an `AGENTS.md`, a pointer line to the rules, `.worktreeinclude` so Claude Code copies the ignored plans and assets into new worktrees, the starter pull request template or its risk section, a route for each unrouted topic rule, the README's sections when an existing README lacks them, and changes based on facts it finds kept elsewhere. It records either template answer in `.drakom-ai/rules/pr.md` as `PR template offer: yes` or `PR template offer: no`. When it recommends adding or refining rules, it drafts an assessment plan in `.drakom-ai/plans/` before asking for approval. Setup names the repo's own skills that overlap a kit skill for you to settle. It names a secret by its path or variable, never its value.

  `drakom-ai-setup audit` gives a read-only report in chat on broken routes, duplicate or conflicting rules, rules tooling already enforces, and kinds of finding reviews repeated, from plans and specs and, on your yes, the last 10 merged pull requests. Setup offers it on later runs. `drakom-pr` now puts an added `## Risk` block, or the risk result when the template has no place for it, at the top after any opening comment, and records the template answer in the same format.
- e7ba17e: Adds the `drakom-dev` skill, installed with `npx skills add TDrake44/drakom-ai-dev-kit`. It builds one pull request's worth of work from a plan or a request: a failing test first for a behavior change, the repo's verification commands, a re-read of the diff and a report. It reads the commands and rules from `AGENTS.md` or `CLAUDE.md`, plus `.drakom-ai/rules/verification.md` and `.drakom-ai/rules/dev.md` when present, updates the status line of the work's plan when one exists, and then offers `drakom-review` here or in a fresh session through `drakom-handoff` when those are installed.
- cd7bc22: Adds the `drakom-handoff` skill, installed with `npx skills add TDrake44/drakom-ai-dev-kit`. It writes a prompt a fresh session can start from to pick up the next step, printed in the chat for the user to copy, and updates the status line of the work's plan when one exists. When the tool has no subagents, `drakom-review` now offers a fresh session for its reviewer, with the prompt written by `drakom-handoff` when that skill is installed.
- 94535d4: Adds the `drakom-plan` skill, installed with `npx skills add TDrake44/drakom-ai-dev-kit`. It turns a request, ticket or issue into a plan file in `.drakom-ai/plans/` before any code is written. By default it interviews you on the open decisions in rounds, each question with its recommended answer, and records your answers in the plan as it goes; `drakom-plan quick` skips the interview. When the work outgrows one pull request, it says so and offers to split the plan into an overview and one plan per piece, in merge order. In a repository with no `.drakom-ai/`, it creates only `.drakom-ai/.gitignore` (ignoring `plans/` and `assets/`) and the plan, and checks that Git ignores `plans/`. It ends by offering `drakom-dev`, here or in a fresh session through `drakom-handoff` when those are installed, and starts nothing without your yes. The interview is adapted from Matt Pocock's `grilling` skill (MIT).
- 1fa7088: Adds the `drakom-pr` skill, installed with `npx skills add TDrake44/drakom-ai-dev-kit`. It opens a pull request on GitHub for the current branch and nothing else: a risk check from the diff alone, a description from the repo's pull request template (found in `.github/`, the root or `docs/`) counted against its word budget, and the link recorded in the work's plan as a `**Pull request:**` line. Before pushing it asks about an unmet acceptance criterion, a change over about 1,000 lines with no reason given, or a review the repo requires. When the repo has no template, it offers once to add its starter as `.github/pull_request_template.md`; when the template has no visible risk heading or box, it offers once to add only the starter's risk section to it. Either way it records your answer in `.drakom-ai/rules/pr.md`. Pull requests open ready for review unless that file asks for drafts. It never merges, replies, resolves threads or edits the pull request once open.

  `drakom-review` now finds the template's risk labels in the same three places, adds an **other code** label (Medium) to its defaults, and at the end of every run, `fix` runs included, offers what has not run: fix rounds, posting, or `drakom-pr` when nothing important is open and there is no pull request yet.
- fbd6e85: `drakom-review post` posts the final report to the pull request as one GitHub review, laid out like Copilot's: a status heading, an expanded list of open issues with small badge chips linked to inline comments, suggestion blocks where a fix is exact, and collapsed sections for pre-existing bugs, what changed and checks. It posts as a comment, never an approval. The recommendations now read `Changes recommended`, `Needs a closer look` and `Approval recommended`; a review run without `fix` or `post` ends by offering whichever fits; and a missing risk box is a finding only where the repo's PR template has one.
- a3d73fb: `drakom-review` reports more of what a pull request review needs: the change's goal in one sentence, the changed files it did not read, a `Reviewer:` line with the model's family and tier, and for each finding a short title, a line range and, for a small edit, exact replacement lines checked against the inputs the code must still accept.
- 3ba754c: Adds the `drakom-review` skill, installed with `npx skills add TDrake44/drakom-ai-dev-kit`. It reviews a pull request or a local branch against the repo's own review rules and verification commands: a risk check from the diff alone, a bug review by a reviewer that did not write the change, and a report of confirmed findings with a recommendation. `drakom-review fix` runs up to three rounds of review and fixes, more only for nits you choose to fix. By default fix rounds may commit and do nothing more; a repo can change that in `.drakom-ai/rules/review.md`. A repo with no review rules, verification commands or PR template gets stated defaults.
- dea440c: `drakom-pr` now gives the pull request link in its reply, not only in tool output. Before `drakom-review` offers to open a pull request, it asks you to fix or leave each open nit, with a recommendation; a nit you want fixed is handled like an important finding, with a fresh re-review.
- cd05f99: `drakom-plan-audit` now reads each plan's `**Pull request:** <url>` lines, which `drakom-pr` writes, and checks their state with `gh pr view`. When the last listed pull request has merged and none is open, it proposes setting the status to `Done: merged in #<number> (<date>)`. A Done plan with a pull request still open is reported, and a plan whose last pull request closed without merging is asked about. A cleanup also offers to delete each plan whose pull requests merged, or move it to `.drakom-ai/specs/`. It changes no status, and deletes or moves none of these plans, without a yes. Pull requests cited anywhere else in a plan are ignored. A link `gh` cannot check is reported as unchecked, and plans without the line get the same checks as before.
- aec0fcd: `drakom-review`'s blind risk check now classifies the whole change on every review, re-reviews and fix rounds included, rather than only the changes since the last review, so a small follow-up commit can no longer show a lower risk than the pull request carries.
- f107c27: The kit's skills move to a root `skills/` folder, so `npx skills add TDrake44/drakom-ai-dev-kit` installs `drakom-ai-setup` and `drakom-plan-audit` at user level (`-g`) or project level.

  `drakom-skill-author` is removed. On a project that has it, delete the folder or keep it as your own skill. The setup skill now suggests skills worth adding without writing them, and says where its references are for both kinds of install.

### Patch Changes

- e5b52f1: `drakom-review` says plainly that `post` and pull requests by number are for GitHub only: it checks that `gh` is signed in and the remote is on GitHub before reviewing, and otherwise offers a local review. The blind risk check runs on the cheap tier your review rules name for the tool, passed by name and never the tool's default; with none named it uses Claude's `haiku`, or asks. The reviewer's model is shown by family and tier, with no effort or tool name. Posted reviews follow one section order, post at once when they have no inline comments, put a description fix's corrected text in a code block so inline code survives, and list a description fix made since the last review as fixed in the description. Threads an earlier run already resolved are left alone, and the risk check reads only the pull request's base, head and diff, not its description.
- 23fcdab: `drakom-review post` reads which review threads you resolved: a finding you resolve without a reply or fix is listed as declined, and one you agreed with stays open until a commit fixes it. Re-reviews now carry nits over, keep an open finding's existing thread instead of commenting again, and quote a declined reply in full. A finding that should be fixed before merging is now important, not a nit. As on Copilot's reviews, any open finding means `Changes recommended`, and `Approval recommended` comes only when nothing is open. After a third round with important findings open, the review says the approach may need rethinking in its summary. The reviewer's model family and tier come from the tool's output rather than the model's own answer, and the reference's base and head command also works on older `gh` versions. Once a review is settled, `post` also reads the pull request's other unresolved threads: it resolves its own and review bots' threads it confirmed fixed, lists people's for them to resolve, and links an existing thread rather than repeating an issue it raises. A wrong claim in the pull request description is listed as a description fix that doesn't change the status and needs no re-review, unless it is a risk box that claims too little.
- de36e24: `drakom-review` lists a part of the pull request description that breaks a rule in its template, such as a Risk line that runs past the level and the label names, as a description fix.

## 0.6.0

### Minor Changes

- 926b03f: **Sync preserves local edits and applies unrelated updates.** When conflicts remain, sync exits `2`, even if it updated other files. Use `sync --accept <path>` to keep your edit under kit management. Sync flags it again when a later kit release changes that file. Use `sync --release <path>` to make the file project-owned. Sync warns when a detached file differs from the kit.
- 5aa8455: **Updated MCP output.** VS Code can use the shared root `.mcp.json`; `.vscode/mcp.json` remains available during its deprecation period. Antigravity uses `serverUrl` and `timeoutSeconds`. Codex blocks stay in place, preserve surrounding text and recognize inline/dotted server definitions.
  
  Sync also preserves legacy Codex content, accepts entries already matching generated output, and rejects unsafe `__proto__` keys.
- e8461e1: **Before your first sync from 0.5:** Preview the changes with `pnpm drakom-ai sync . --dry-run`. If you previously used `init --skip-mcp`, an existing `.drakom-ai/mcp-servers.yaml` now enables MCP on the next sync. Remove the registry if MCP should stay off. Both `headers` and `http.headers` are checked for literal credentials. Use `${VAR}` references for those values. See the [0.6 upgrade guide](https://github.com/TDrake44/drakom-ai-dev-kit/blob/main/docs/upgrading.md#upgrading-to-060) for client-specific settings, line endings, and downgrade limits.
  
  **Choose MCP clients.** Select clients with registry-level `clients` and per-server `skip`. Overrides can remove environment/header values with `null`; `notSecret` marks ordinary values without allowing token-shaped secrets.

### Patch Changes

- 15809c5: **Safer writes and recovery.** `init` and `sync` recheck files before rewriting them and stop if they detect an intervening edit. Rewritten files keep their permissions. Before applying changes, the CLI checks that files it plans to rewrite or delete contain valid UTF-8. If a write fails, rollback attempts each remaining recovery step and reports any paths it could not restore.
- ca923c1: **Project-owned READMEs.** Editing or deleting the starter rules/specs READMEs no longer blocks sync. Existing files are preserved; their old managed records are removed automatically.
- 62764f0: **Windows line endings.** Preserve existing LF/CRLF conventions and avoid false conflicts after checkout conversion. Sync migrates matching legacy fingerprints automatically; unrecoverable old mixed-ending records remain conflicts.
- 54d29eb: **Smaller package.** Stop shipping TypeScript declarations for the CLI; no importable API is exposed.
- 186797b: **Fresh-install instructions.** Skills create missing AGENTS.md sections outside the managed block and invoke the CLI through the project's package runner.
- e9366fc: **Consistent plan headers.** The setup assessment template and the skill-author plan example now use the `Status` and `Synopsis` header expected by `drakom-plan-audit`.
- ff8a724: **Windows diagnostics.** State-file errors use forward-slash paths, consistent with other CLI output.
- 9cf9a0a: **Clearer setup and rule guidance.** Setup assessments are shorter and identify when to ask for approval. Projects choose which rules they need. Include prohibitions when relevant, and split a rule file before it exceeds 150 lines.
- 362615a: **Safe Claude symlinks.** Accept `.claude/skills` and `CLAUDE.md` links to their canonical targets; refuse writes through other links. Unanswered initialization prompts exit cleanly.
- 62764f0: **Linked target directories.** Init and sync accept a directory symlink as their target. Broken, looping and file links produce actionable errors.
- bbd8dc4: **Accurate summaries.** Applied plans no longer say "no changes made". Dry-run and check retain their own no-change summaries.

## 0.5.0

### Minor Changes

- 72ae6cb: - `init` now creates the Claude Code skill mirrors in `.claude/skills/`, so a freshly initialized project passes `sync --check` and `/drakom-ai-setup` works in Claude Code without running `sync` first.
  - `drakom-plan-audit` is now installed by default. Existing projects receive it, its Claude mirror, and an updated `AGENTS.md` block on their next `sync`. The interactive prompt and the `--with-plan-audit` flag are removed; passing the flag now fails as an unknown option.
  - Unknown `init` and `sync` options now report "Unknown option" instead of naming the wrong command.

## 0.4.0

### Minor Changes

- af31fe1: **New skill: `drakom-skill-author`.** Helps your project create and maintain its own agent skills.
  - It suggests a skill only when work has repeated, found in git and pull request history, CI configuration, package scripts, contribution docs, or plans, or when you ask for one.
  - Drafts are short, use your project's name as a prefix, point to your rules instead of copying them, and include verification commands and approval points.
  - It tests each draft against a recent real task, and later fixes or retires skills that stop being useful.
  - It always asks before creating or changing a project skill.
  - Includes a reference of common skill types with a worked example (`references/skill-patterns.md`).
  - The setup skill now hands new skills to it.

- e238424: **`sync` adds new default files from newer releases.** Existing projects get files introduced in later versions without re-running `init`.
  - A file is added only if it is new since the version you have installed and nothing already exists at its path.
  - If something does exist there, `sync` reports a conflict and writes nothing.
  - New skills get their Claude mirror in the same run.

- 3c37c85: **Clearer project assessments and a guide for writing rules.**
  - The setup skill's assessment now records, for every existing context file: what it is, who owns it, what to do with it and why, what depends on it, whether it is approved, and how to verify it. "Omit" never means delete.
  - The setup skill now looks in `.drakom-ai/plans/` and `.drakom-ai/specs/` directly, because gitignore-aware search tools skip them.
  - New `rule-anatomy.md` explains how to structure a rule, how long it should be, and which kinds of rules are worth writing.
  - `init` now lists the existing context files it found before showing the planned changes.

### Patch Changes

- 2f89a23: **`drakom-ai --version`** (or `-V`) prints the installed version. `init` and `sync` now stop, without changing anything, if the installed package is internally inconsistent, and tell you to reinstall.
- 860cfc5: **MCP config files keep their comments and formatting.**
  - `.vscode/mcp.json` may now contain comments and trailing commas. `.mcp.json` and `.agents/mcp_config.json` must still be plain JSON.
  - `sync` no longer rewrites MCP config files when nothing it manages has changed. When something does change, only those entries are edited.

### Upgrading from 0.3.0

Update the package, then run `drakom-ai sync` once. It will:

- add the new `drakom-skill-author` skill, its `skill-patterns.md` reference, and its Claude mirror;
- add `rule-anatomy.md` next to the setup skill;
- update the setup skill and the managed block in `AGENTS.md`.

If you have edited any kit-managed file or the managed `AGENTS.md` block, or already have a file at one of the new paths, `sync` reports a conflict and changes nothing until you resolve it.

## 0.3.0

### Minor Changes

- 5f749eb: Improve MCP synchronization, variable handling, and repository scanning.
  
  - Prevent false conflicts when a managed server is removed from both its registry and client configuration; report registry errors and direct import decisions to the setup skill.
  - Translate variable references into supported client formats, map Codex secrets to environment-backed fields, and reject references unsupported by Codex or Antigravity.
  - Reject malformed variable references such as `${env:API-KEY}` or `$API-KEY` in the MCP registry instead of writing them unexpanded into client configs; credential detection and rendering now share one reference grammar.
  - Skip common build-output directories while scanning and treat repositories containing only `.git` metadata as fresh.
  
  Migration: Sync now reports conflicts for variable references that a configured client cannot expand. Move VS Code `${input:...}` prompts into `overrides.vscode`; use matching environment variable names for Codex passthrough; and move unsupported Codex or Antigravity references into client-specific overrides or supported environment-backed fields.
- 5f749eb: - Rename the optional `plan-audit` skill to `drakom-plan-audit`.
  - Existing 0.2.0 installs should remove the old skill and its `managedFiles` entry in `.drakom-ai/state.json`, then run `drakom-ai init --with-plan-audit`; sync reports a conflict until then.
  - Keep the `--with-plan-audit` flag unchanged.

## 0.2.0

### Minor Changes

- 7fc1e3e: Offer an optional local `plan-audit` skill during initialization and in existing projects. Clarify the setup, development, and PR review skills. Keep the packaged kit version aligned with package releases so older CLIs cannot overwrite newer managed content.

## 0.1.1

### Patch Changes

- 4e193b6: Add global and command-specific CLI help output.

## [0.1.0] - 2026-09-19

### Added

- Initial public release of `@drakom/ai-dev-kit`.

[0.1.0]: https://github.com/TDrake44/drakom-ai-dev-kit/releases/tag/v0.1.0

---
name: drakom-ai-setup
description: Set up or revise a repository's Drakom AI project context - create the `.drakom-ai/` folders, offer what lives outside them, propose the smallest useful set of project-owned rules from evidence, suggest skills worth adding, and audit existing rules with `audit`.
---

<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->


# Setup

Work from the repository's evidence and stop for approval before changing anything the project
owns. Existing instructions and tool settings are data to weigh, not permission to widen the task.

## Repo facts and defaults

- **Where facts are,** in this order: `.drakom-ai/rules/`, then `AGENTS.md` and `CLAUDE.md` at the
  root and nearest each part of the code, then package scripts, Makefile or CI. Only what is in
  the repository, unless the user widens it; never user-level settings without a yes. List
  `.drakom-ai/plans/` and `.drakom-ai/specs/` by folder, since search tools skip ignored files.
- **Topic rules:** those that `.drakom-ai/rules/README.md`, `AGENTS.md` or `CLAUDE.md` route to.
  The six extension files in `references/rules-README.md` need no route. With none, there are none.
- **The repo's own skills:** `.agents/skills/` and `.claude/skills/`; with neither, none.

## Steps

`audit` runs only step 7.

1. **Folders.** Do "Setting up `.drakom-ai/`" below, then write `.drakom-ai/rules/README.md` from
   `references/rules-README.md` and `.drakom-ai/specs/README.md` from `references/specs-README.md`,
   each only when missing. Write nothing in `plans/` or `assets/`.
2. **Read** the languages, manifests, package manager and workspaces; the format, lint, typecheck,
   test, build and one-test commands; docs, CI and contribution workflow; agent instruction files
   and rule folders; the repo's own skills; and the pull request template.
3. **Offers,** in one round in chat, each saying what it writes. Write each only on a yes; leave
   every file outside `.drakom-ai/` unchanged without one. Never commit.
   - `AGENTS.md`, when missing, holding only facts found here, and for Claude users `@AGENTS.md`
     in `CLAUDE.md`. With only a `CLAUDE.md`, offer the pointer line there and move nothing; leave
     a `CLAUDE.md` that links to `AGENTS.md` as it is.
   - The pointer line ``Project rules for agents: `.drakom-ai/rules/README.md`.``, plain text that
     an agent follows when it needs the rules, never an `@` import.
   - `.worktreeinclude` at the root with `.drakom-ai/plans/*` and `.drakom-ai/assets/*`, so a new
     worktree gets the ignored plans and assets; to an existing file, add only the missing lines.
   - **Template:** look for `pull_request_template.md` (any case, or `.txt`) in `.github/`, the
     root or `docs/`. Unless `.drakom-ai/rules/pr.md` already records an answer: with no template,
     offer once to add the starter as `pull_request_template.md` in `.github/`; with a template
     that has no visible heading or box for the risk, offer once to add only the starter's risk
     section to that file: its comment from "Risk labels" on, at the top of the file's opening
     comment or as a new opening comment, unless that comment already lists labels, and the
     `## Risk` block at the top, after any opening comment. The starter is
     `references/pull_request_template.md`. Say first that either answer writes one line in
     `.drakom-ai/rules/pr.md`: `PR template offer: yes` or `PR template offer: no`.
   - **Facts kept elsewhere,** such as in `CONTRIBUTING.md`: offer to move or point to the
     verification commands and review rules. Propose lines for `.drakom-ai/rules/pr.md` only for
     a draft habit, or pull request and commit conventions outside `AGENTS.md` and `CLAUDE.md`.
   - A route for each rules file in `.drakom-ai/rules/` that has none: a line in the README's
     "Topic rules" list, or one where the repo already routes rules. An existing README without the
     "Topic rules" or "Extension files" section: offer to add it from `references/rules-README.md`.
   - **Overlaps:** name each of the repo's own skills that does the job of a `drakom-*` skill, with
     keep both, rename theirs or remove theirs for the user to settle. Change none.
4. **Recommend** in four categories. **Keep:** useful context, unchanged. **Refine:** valuable but
   inaccurate, duplicated or badly routed. **Add:** a missing rule or route the evidence supports,
   drafted from `references/rule-anatomy.md`; a recurring multi-step workflow goes here as a
   suggested skill, its name and a one-line purpose, never written. **Omit:** not worth its upkeep;
   Omit never means delete. A rule is stable policy that changes how code is written and that
   formatters, linters, types or tests do not already enforce; one-off knowledge stays in docs. Do
   not assume a repo needs rules or skills, and never install a fixed set.
   - One row per source or bounded group: path, evidence, decision. Add and Refine rows also give
     ownership (project-owned, kit skill or unknown), destination or action, dependencies (routes,
     scripts, companion files), approval status and verification.
   - Ask only what the repository cannot answer. With Add or Refine items, draft the plan in
     `.drakom-ai/plans/` from `references/assessment-plan-template.md`.
5. **Approval.** Stop and ask before creating or changing any rule or instruction file. A yes
   covers only the items listed; a rewrite of meaning or user-level settings each need their own.
6. **Apply and verify** only what was approved, keeping unrelated content. Create each rule in
   `.drakom-ai/rules/` by the anatomy and route it where the repo already routes rules, else in the
   README's "Topic rules" list. Never move a route unasked; revise the routes an approved change
   makes stale. Check that every path exists, every command runs with the repo's tooling and every
   route and link resolves, then run the repo's relevant checks. Report the files created, the
   context kept, each check and its result, and the open decisions.
7. **Rules audit.** When `.drakom-ai/rules/` held rules files besides its README before this run,
   offer the audit at the end. It follows `references/rules-audit.md`, reports in chat and writes
   nothing without a yes, each change approved on its own.

## Setting up `.drakom-ai/`

Before writing under `.drakom-ai/` at the repository root, create only what is missing and change
nothing that exists: `.drakom-ai/.gitignore` holding the two lines `plans/` and `assets/`, and the
folder the file goes in. In a Git repository, `git check-ignore -q --no-index .drakom-ai/plans/`
must then succeed, run from the repository root; if it fails, stop and tell the user, and edit no
ignore file.

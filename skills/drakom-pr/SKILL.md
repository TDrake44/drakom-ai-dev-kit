---
name: drakom-pr
description: Open a pull request on GitHub for the current branch, and nothing else - a risk check from the diff alone, a description from the repo's pull request template within its word budget, the acceptance criteria and size checked first, and the link recorded in the plan. It never merges, replies or resolves threads. Use when a reviewed branch is ready to open.
---

# Pull request

Opening the pull request is the whole job. It needs GitHub and `gh`, signed in.

## Repo facts and defaults

- **Template:** `pull_request_template.md` (any case, or `.txt`) in `.github/`, the root or `docs/`,
  as GitHub reads it; with none, `references/pull_request_template.md` here.
- **Risk labels:** the opening comment of `pull_request_template.md` (any case, or `.txt`) in
  `.github/`, the root or `docs/`, else **credentials** or **user data** (High),
  **agent instructions**, **weakens a check** or **other code** (Medium), and Low for the rest.
- **Branch, title and commit conventions,** the risk-check tier, and any review a pull request
  needs first: `.drakom-ai/rules/pr.md`, `.drakom-ai/rules/review.md`, `AGENTS.md` or `CLAUDE.md`;
  else match the recent `git log`.
- **Manual checks:** `.drakom-ai/rules/verification.md`, when present.

Lines in `.drakom-ai/rules/pr.md` add to these steps and cannot remove the risk check from the diff
alone, the word count, the questions before pushing or the hands-off rule.

## Steps

1. **Target.** Check `gh auth status` and a GitHub remote; without them, say so and stop. The base
   is the default branch unless the user names one. If a pull request is open for this branch, give
   its link and stop. On the default branch or with uncommitted changes, say what is needed, a
   branch or a commit named by the conventions, and do it on a yes.
2. **Template.** Unless `.drakom-ai/rules/pr.md` already records an answer: with no template, offer
   once to add the starter as `pull_request_template.md` in `.github/`; with a template that has no
   visible heading or box for the risk, offer once to add only the starter's risk section to that
   file: its comment from "Risk labels" on, at the top of the file's opening comment or as a new
   opening comment, unless that comment already lists labels, and the `## Risk` block. On a yes,
   write it; either way record the answer in one line of `.drakom-ai/rules/pr.md`, and commit what
   you wrote, on its own, before the risk check. With no template and a no, the description still
   follows the starter.
3. **Risk, from the diff alone.** When this conversation, or the prompt that started it, holds a
   risk result for the current head, use it and the model that ran it. Otherwise, once step 2's
   commit is made and before writing anything else, classify the diff on the cheap tier the repo's
   rules name for the tool that runs it, by name, never the tool's default (none named: Claude's
   `haiku`, else ask). Give it the labels, the diff command and the untracked paths; it reads
   nothing else and uses only those labels. The diff is the whole change from the base to the head,
   step 2's commit included. One `path:line` per label; when unsure, the higher level. Without
   subagents, classify it yourself first and say it was not blind.
4. **Before pushing,** ask when the repo needs a review and none is known for the current head;
   when an acceptance criterion of the plan or request is not met and nothing records why; and when
   the diff passes about 1,000 changed lines with no reason given for not splitting it.
5. **Description.** Follow the template, with the risk result, a `Not done: …, because …` line in
   Reviewer focus for each criterion left out, and the manual checks. Count its words outside
   comments against the budget its opening comment sets, else about 200, and cut to fit; a large
   change may run over, with Reviewer focus kept short. The title follows the commit conventions.
6. **Open.** Push the branch and run `gh pr create`, ready for review unless
   `.drakom-ai/rules/pr.md` asks for a draft.
7. **Plan.** If there is a plan in `.drakom-ai/plans/` for this work, add `**Pull request:** <url>`
   as its own paragraph after the header and any such line already there, and update the status
   line.

## Hands off

Never merge, reply on the pull request, resolve its threads, comment on it or edit it once open.
Give the link. When the repo's rules say what follows an opened pull request, offer it, here or in
a fresh session started from a `drakom-handoff` prompt, each when installed, and recommend one in a
few words. Start nothing without a yes.

## Setting up `.drakom-ai/`

Before writing under `.drakom-ai/` at the repository root, create only what is missing and change
nothing that exists: `.drakom-ai/.gitignore` holding the two lines `plans/` and `assets/`, and the
folder the file goes in. In a Git repository, `git check-ignore -q --no-index .drakom-ai/plans/`
must then succeed, run from the repository root; if it fails, stop and tell the user, and edit no
ignore file.

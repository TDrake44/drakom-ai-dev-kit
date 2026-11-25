---
name: drakom-dev
description: Build one pull request's worth of work from a plan or a request, test first, then run the repo's checks, re-read the diff and report. Use to implement a planned step, a feature, a bug fix or a refactor.
---

# Dev

## Repo facts and defaults

- **Verification commands,** including how to run one test: `AGENTS.md` or `CLAUDE.md`, plus
  `.drakom-ai/rules/verification.md` when present; else the package scripts, Makefile or CI. With
  none, say so.
- **Review rules:** `.drakom-ai/rules/review.md`, the `## Code Review Rules` section, and the topic
  rules that `.drakom-ai/rules/README.md` or those files route to for the changed paths. With none:
  a claim nothing backs, an input the author did not try, a stated risk that claims too little.
- **What a change needs,** such as a changelog entry or docs, and the branch and commit
  conventions: the same files; else match the recent `git log`.

Lines in `.drakom-ai/rules/dev.md` add to these steps and cannot remove the failing test first, the
scope, or reporting each check as it ran.

## Steps

1. Start from the plan in `.drakom-ai/plans/` for this work, when there is one, and build only its
   next pull request. Otherwise state the acceptance criteria you take from the request.
2. When the work outgrows one pull request's purpose, stop and propose a split.
3. For a behavior change, write one test, run it alone and see it fail for the right reason, then
   write the least code that passes it. Repeat.
4. Change only what the scope needs. Leave unrelated changes, and other people's, alone.
5. Run the verification commands. Never report a failing or skipped run as passing.
6. Re-read the whole diff against the criteria and the review rules, fix what you find, and add
   what the repo requires of a change.
7. Report the changed files, each check and its result, what is left, and the part most worth a
   person's look.

Don't commit or push unless the user or the repo's rules say to. When the checks pass, update the
plan's status line, if there is a plan; never create a plan. Then offer a review with
`drakom-review`, here or in a fresh session started from a `drakom-handoff` prompt, each when
installed, and recommend one in a few words. Without them, offer a review by someone who did not
write the change. Start nothing without a yes; a no keeps you on this step.

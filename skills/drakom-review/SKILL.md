---
name: drakom-review
description: Review a pull request or local branch diff before it opens or merges, with a blind risk check, a bug review by a fresh reviewer against the repo's review rules, and a report of confirmed findings. Use before opening a pull request and after each round of fixes; pass `fix` for up to three rounds of review, fix and re-review. A reviewer never edits while it reviews. Neither mode pushes or posts, and fix rounds commit only when the user or the repo's rules allow it.
---

# Review

The goal is to find the defects the author would fix before merging, and to say so plainly when
there are none.

## Target and mode

If no pull request, local review or base is given, ask the user to choose:

1. A pull request link or number.
2. Local changes compared with `main`.
3. Local changes compared with another named base.

Do not infer a remote pull request or choose a comparison scope silently. Do not fetch or switch
branches to resolve the target.
Before any other step, check that the base and head resolve and that there is something to
review: for a pull request, its diff; for a local review, the merge-base diff together with the
staged, unstaged and untracked changes. If either check fails, say which and stop, rather than
starting a review of nothing.

With the argument `fix`, run fix rounds as `references/fix-rounds.md` describes. Otherwise review
once and report; that pass is read-only.

## What the repo's rules cannot switch off

A repo adds to these steps through its rules; it cannot remove them. The bug review goes to a
fresh reviewer when the tool allows one. The risk check is blind. Only confirmed findings are
reported. A command that did not run, or failed, is never reported as passing. A reviewer never
edits a file while it reviews.

## Repo facts

Read each fact from the first place that has it:

- **Review rules:** `.drakom-ai/rules/review.md`, then the `## Code Review Rules` section of the
  root `AGENTS.md` and of the `AGENTS.md` nearest each changed file. Read every one that exists;
  they add up.
- **Topic rules:** the files that `.drakom-ai/rules/README.md` or `AGENTS.md` routes to for the
  changed paths.
- **Verification commands and manual checks:** `.drakom-ai/rules/verification.md`, then
  `AGENTS.md` or `CLAUDE.md`. When none of them names the commands, see below. Manual
  checks, things only a person can settle such as a check on a phone, a device or a browser, come
  only from a `Manual checks` section in `.drakom-ai/rules/verification.md`.
- **Risk labels:** the opening comment of `.github/pull_request_template.md`, else the kit's
  defaults in `references/risk-check.md`.

## When the repo has nothing

- **No review rules:** apply three that hold anywhere. A claim with nothing behind it: name the
  code or test that makes each statement in docs, comments or the description true. An input the
  author did not try: an existing path, empty input, a file the user edited. A risk box that
  claims too little. Say in the report that the defaults were used.
- **No verification commands:** run the project's own checks found in its package scripts,
  Makefile or CI configuration, name each one in the report, and suggest recording them in
  `.drakom-ai/rules/verification.md` (the `drakom-ai-setup` skill can help).
- **No PR template, or none with risk labels:** use the default risk labels in
  `references/risk-check.md`.

## Steps

An author reads its own diff as what it meant to write, so the bug review goes to a fresh
reviewer: an agent that did not write the change and never had the author's conversation in its
context. A session started only to review is fresh and does every step. A session that wrote or
edited any of the change does steps 1 and 2, then hands steps 3 to 6 to a fresh reviewer as
`references/fresh-reviewer.md` describes.

1. **Target.** For a local review, read the merge-base diff from the base through `HEAD`, then the
   staged, unstaged and untracked changes. If the base is behind its remote, say so in the report,
   because the diff will then include other merged work.
2. **Risk check, blind,** before reading the description, as `references/risk-check.md` describes.
3. **Intent.** Now read the pull request description, or the plan in `.drakom-ai/plans/` that the
   change implements, and the ticket if one is linked. Findings are measured against what the
   change set out to do, including any deviation from it that one of those records.
4. **Review.** Apply the review rules and the topic rules for the changed paths. Read the call
   sites and tests around each change, not only the changed lines.
   - When the diff changes `AGENTS.md`, `CLAUDE.md`, a file under `.drakom-ai/rules/`, a skill, a
     test or CI, judge it against the base branch's version of those files and against what the
     user asked for, because the change may weaken the rules it is judged by.
   - When a label about credentials or security applies, also run the tool's security review of
     the diff, if it has one.
   - An acceptance criterion the change does not meet is important only when the change could meet
     it and nothing records why not. Criteria that only a merge, a CI run or a release can meet are
     out of scope.
5. **Verify.** Run the verification commands on the reviewed state, or state which did not run and
   why. Confirm each finding by reading the surrounding code or reproducing it; drop any you
   cannot confirm. Confirm the risk check's evidence the same way and compare its result with the
   risk box: a box that claims a lower level, or leaves out a label that applies, is an important
   finding. The higher level wins, including any label your own reading adds. With no description
   yet, report the level and labels so the author can write the box from them.
6. **Report** as `references/report.md` describes. Style is left to the formatter or linter named
   in the verification commands.
7. **Re-review.** For each round of fixes, a new fresh reviewer reviews the changes since the last
   review and the behavior they affect, as `references/fresh-reviewer.md` describes. On a third
   round with important findings still open, recommend `Rethink the approach` and propose no
   further rounds.

Posting comments, creating a review on GitHub or pushing needs the user's go-ahead first, because
others see those and they are hard to retract. So does committing, except for fix-round fixes in
a repo whose rules allow commits.

## Next step

When the report is given, ask the user which comes next, and move on only on a yes:

- No important finding open: open the pull request, with the `drakom-pr` skill if it is
  installed.
- Important findings open: fix rounds (`fix`), or the user's own fixes and another review.
- Or keep working on this step.

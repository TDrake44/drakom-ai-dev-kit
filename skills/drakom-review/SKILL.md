---
name: drakom-review
description: Review a pull request or local branch before it opens or merges, with a risk check from the diff alone, a bug review by a reviewer that did not write the change, and a report of confirmed findings. Pass `fix` for up to three rounds of review and fixes.
---

# Review

Find what the author would fix before merging. "No findings" is a valid result.

## Repo facts and defaults

- **Review rules:** `.drakom-ai/rules/review.md`, then the `## Code Review Rules` section of
  `AGENTS.md` or `CLAUDE.md`, plus the topic rules that `.drakom-ai/rules/README.md` or those files
  route to for the changed paths. With none: a claim nothing backs, an input the author did not
  try, a risk box that claims too little.
- **Verification commands:** `.drakom-ai/rules/verification.md`, `AGENTS.md` or `CLAUDE.md`, else
  the package scripts, Makefile or CI. Name the ones you used.
- **Risk labels:** the opening comment of `.github/pull_request_template.md`, else **credentials**
  or **user data** (High), **agent instructions** or **weakens a check** (Medium, as is any other
  code change), and Low for the rest.

A repo's rules add to the steps below. They cannot remove the risk check from the diff alone, the
fresh reviewer, or the rule that only confirmed findings are reported.

## Each review

1. **Target.** A pull request or base the user names. Otherwise, on a branch other than the
   default, where it split from the default branch; on the default branch, its uncommitted changes
   against `HEAD`. Ask only when the default branch cannot be found locally. Do not fetch or switch
   branches. Stop if the base or head does not resolve, or there is nothing to review, counting
   staged, unstaged and untracked changes.
2. **Risk, from the diff alone.** Before reading the description, plan or commit messages,
   classify the diff: on a cheaper subagent, if the tool has one, given the labels, the command
   that prints the diff and the untracked paths, and told to read nothing else. On a re-review,
   classify only the changes since the last review. One `path:line` per label; when unsure, the
   higher level.
3. **Fresh reviewer.** If you wrote or fixed any of the change, hand steps 4 and 5 to a subagent on
   a full model that never saw your conversation. Give it the tool and model it runs on, the base
   and head, the uncommitted paths, the description or the plan in `.drakom-ai/plans/`, where the
   rules are, the risk result and, on a re-review, the round number, the changes since the last
   review, the user's answers so far and the last report's important findings, copied as they were
   with no notes. Nothing else. Without subagents, review it yourself and say so.
4. **Review.** Read the description or plan, apply the rules, and read the callers and tests
   around each change; on a re-review, only the changes since the last review, the behavior they
   affect and the earlier findings. When the diff changes `AGENTS.md`, `CLAUDE.md`,
   `.drakom-ai/rules/`, a skill, a test or CI, judge it against the base branch's version too. Run
   the verification commands. Keep only findings you confirmed by reading the code or reproducing
   them. Important: wrong behavior, lost files, a false claim, a broken build, a risk box below the
   risk result, or something the plan or description asks for that is missing or partial, unless
   they or the user's answers say why. At most three nits. No style. The reviewer never edits.
5. **Report:**
   - Recommendation: `Rethink the approach` (round 3, important findings open), `Fix before merge`,
     `Could not judge` (say what did not run or was not read) or `Ready to merge`
   - Goal: what the change is for, in one sentence from the description or plan
   - Reviewed: base, head and the uncommitted paths, and each changed file not read, with why
   - Risk: level and labels, against the risk box
   - Review: fresh, or by the author
   - Reviewer: the tool, model and effort, as the tool reports them
   - Findings: a short title, file and line range, what breaks and the fix, as exact replacement
     lines for a small edit, checked against every input the code must still accept
   - Verification: each command and whether it passed, failed or did not run

## Fix rounds

With `fix`, run up to three rounds. Each round runs steps 2 to 5 with a new fresh reviewer. Stop
when no important finding is open, and after round 3's report; otherwise the author fixes the
important findings and runs the verification commands. The changes since the last review are the
commits since its head and every file the fixes touched, committed or not; when they cannot be
told apart, review the whole change and say so. Nits and bugs the change did not introduce are
listed, not fixed. Report the highest risk any round found. Ask the user before building something
the change left out, when a fix would change the scope or a decision they made, when you believe a
finding is wrong, or when the risk rises. When a kind of finding comes back, say where to stop it
at its source: a test, a lint rule or a review rule.

## What it may do

By default, fix rounds may commit their fixes, and nothing more: no pushing, posting, commenting
or editing the pull request. A repo can change this in `.drakom-ai/rules/review.md`, and the
tool's own permissions and hooks still apply. A recommendation is never an approval.

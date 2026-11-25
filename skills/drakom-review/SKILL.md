---
name: drakom-review
description: Review a pull request or local branch before it opens or merges, with a risk check from the diff alone, a bug review by a reviewer that did not write the change, and a report of confirmed findings. Pass `fix` for up to three rounds of review and fixes, and `post` to post the report to the pull request as one review.
---

# Review

Find what the author would fix before merging. "No findings" is a valid result. Local reviews and
`fix` work on any host; `post` and pull requests by number need GitHub and `gh`.

## Repo facts and defaults

- **Review rules:** `.drakom-ai/rules/review.md`, then the `## Code Review Rules` section of
  `AGENTS.md` or `CLAUDE.md`, plus the topic rules that `.drakom-ai/rules/README.md` or those files
  route to for the changed paths. With none: a claim nothing backs, an input the author did not
  try, a stated risk that claims too little.
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
   staged, unstaged and untracked changes. For `post` or a pull request by number, first check `gh`
   is signed in and the remote is GitHub; if not, say so, offer a local review and ask for the base.
2. **Risk, from the diff alone.** Before reading the description, plan or commit messages (for a
   pull request, take its base and head as `references/github-review.md` says), classify the diff on
   the cheap tier the review rules name for the tool that runs it, by name, never the tool's default
   (none named: Claude's `haiku`, else ask). Give it the labels, the diff command and the untracked
   paths; it reads nothing else and uses only those labels. On a re-review, classify only the
   changes since the last review. One `path:line` per label; when unsure, the higher level.
3. **Fresh reviewer.** If you wrote or fixed any of the change, hand steps 4 and 5 to a subagent on
   a full model that never saw your conversation. Give it the tool and model it runs on, the base
   and head, the uncommitted paths, the description or the plan in `.drakom-ai/plans/`, where the
   rules are, the risk result and, on a re-review, the round number, the changes since the last
   review, the user's answers so far and every finding of the last report, copied as they were
   with no notes. Nothing else. Without subagents, review it yourself and say so.
4. **Review.** Read the description or plan, apply the rules, and read the callers and tests around
   each change; on a re-review, only the changes since the last review, the behavior they affect and
   the earlier findings. When the diff changes `AGENTS.md`, `CLAUDE.md`, `.drakom-ai/rules/`, a
   skill, a test or CI, judge it against the base branch's version too. Run the verification
   commands. Keep only findings you confirmed by reading the code or reproducing them. Important:
   anything to fix before merging: wrong behavior, lost files, a false claim, a broken build, a
   stated risk below the risk result, or a gap against the plan or description, unless they or the
   user's answers say why. Any other wrong or missing claim in the description, or a broken template
   rule, is a description fix. Nits may stay; at most three. No style. The reviewer never edits.
5. **Report:**
   - Recommendation: `Changes recommended` if an important finding or nit is open, not counting
     pre-existing bugs or description fixes; else `Needs a closer look` if something did not run,
     was not read or needs a person (say what); else `Approval recommended`
   - Goal: what the change is for, in one sentence from the description or plan
   - Reviewed: base, head and the uncommitted paths, and each changed file not read, with why
   - Risk: level and labels, against the risk the description states
   - Review: fresh, or by the author
   - Reviewer: the model's family and tier, from the tool's output, not the model's word
   - Findings: a short title, file and line range, what breaks and the fix, as exact replacement
     lines for a small edit, checked against every input the code must still accept; description
     fixes apart, each with the corrected text
   - Verification: each command and whether it passed, failed or did not run

When neither `fix` nor `post` was passed, end by offering what fits, and start neither without a
yes: fix rounds when important findings are open, posting when the target is a pull request.

## Fix rounds

With `fix`, run up to three rounds. Each round runs steps 2 to 5 with a new fresh reviewer. Stop
when no important finding is open, and after round 3's report, saying the approach may need
rethinking if important ones remain; otherwise the author fixes the important findings and runs the
verification commands. The changes since the last review are the commits since its head and every
file the fixes touched, committed or not; when they cannot be told apart, review the whole change
and say so. Nits and bugs the change did not introduce are listed, not fixed. Report the highest
risk any round found. Ask the user before building what the change left out, when a fix would change
the scope or a decision they made, when you believe a finding is wrong, or when the risk rises. When
a kind of finding comes back, say where to stop it: a test, a lint rule or a review rule.

## What it may do

By default, fix rounds may commit their fixes, and nothing more: no pushing, posting, commenting or
editing the pull request. `post` adds two things: the final report, posted to the pull request as
one review, laid out as `references/github-review.md` says, and resolving the threads it confirmed
fixed, its own and bots', never a person's. A repo can change this in `.drakom-ai/rules/review.md`,
and the tool's own permissions and hooks still apply. A recommendation is never an approval.

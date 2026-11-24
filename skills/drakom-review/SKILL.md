---
name: drakom-review
description: Review a pull request or local branch before it opens or merges, with a risk check from the diff alone, a bug review by a reviewer that did not write the change, and a report of confirmed findings. Pass `fix` for up to three rounds of review and fixes.
---

# Review

Find what the author would fix before merging. "No findings" is a valid result.

## Repo facts and defaults

- **Review rules:** `.drakom-ai/rules/review.md`, then the `## Code Review Rules` section of
  `AGENTS.md` or `CLAUDE.md`, plus the topic rules they route to for the changed paths. With none:
  a claim nothing backs, an input the author did not try, a risk box that claims too little.
- **Verification commands:** `.drakom-ai/rules/verification.md`, `AGENTS.md` or `CLAUDE.md`, else
  the package scripts, Makefile or CI. Name the ones you used.
- **Risk labels:** the opening comment of `.github/pull_request_template.md`, else **credentials**
  or **user data** (High), **agent instructions** or **weakens a check** (Medium, as is any other
  code change), and Low for the rest.

A repo's rules add to the steps below. They cannot remove the risk check from the diff alone, the
fresh reviewer, or the rule that only confirmed findings are reported.

## Each review

1. **Target.** A pull request, or local changes against a base the user names; ask if neither is
   given, and do not fetch or switch branches. Stop if the base or head does not resolve, or there
   is nothing to review, counting staged, unstaged and untracked changes.
2. **Risk, from the diff alone.** Before reading the description, plan or commit messages,
   classify the diff: on a cheaper subagent given only the diff and the labels, if the tool has
   one. One `path:line` per label; when unsure, the higher level.
3. **Fresh reviewer.** If you wrote or fixed any of the change, hand steps 4 and 5 to a subagent on
   a full model that never saw your conversation. Give it the base and head, the uncommitted
   paths, the description or the plan in `.drakom-ai/plans/`, where the rules are, the risk result
   and, on a re-review, the last report's open findings copied as they were. Nothing else. Without
   subagents, review it yourself and say so.
4. **Review.** Read the description or plan, apply the rules, and read the callers and tests
   around each change. When the diff changes `AGENTS.md`, `CLAUDE.md`, `.drakom-ai/rules/`, a
   skill, a test or CI, judge it against the base branch's version too. Run the verification
   commands. Keep only findings you confirmed by reading the code or reproducing them. Important:
   wrong behavior, lost files, a false claim, a broken build, or a risk box below the risk result.
   At most three nits. No style. The reviewer never edits.
5. **Report:**
   - Recommendation: `Rethink the approach` (round 3, important findings open), `Fix before merge`,
     `Could not judge` (say what did not run or was not read) or `Ready to merge`
   - Reviewed: base, head and the uncommitted paths
   - Risk: level and labels, against the risk box
   - Review: fresh, or by the author
   - Findings: file and line, what breaks, the fix
   - Verification: each command and whether it passed, failed or did not run

## Fix rounds

With `fix`, run up to three rounds. Each round runs steps 2 to 5 with a new fresh reviewer, then
the author fixes the important findings and runs the verification commands. Nits and bugs the
change did not introduce are listed, not fixed. Report the highest risk any round found. Stop when
no important finding is open. Ask the user when a fix would change the scope or a decision they
made, when you believe a finding is wrong, or when the risk rises. When a kind of finding comes
back, say where to stop it at its source: a test, a lint rule or a review rule.

## What it may do

By default, fix rounds may commit their fixes, and nothing more: no pushing, posting, commenting
or editing the pull request. A repo can change this in `.drakom-ai/rules/review.md`, and the
tool's own permissions and hooks still apply. A recommendation is never an approval.

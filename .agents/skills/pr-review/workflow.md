# PR Review

The goal is to find defects the author would fix before merging, and to say so plainly when there are none.

An author reads its own diff as what it meant to write, so the bug review goes to a fresh reviewer: an agent that did not write the change and has never had the author's conversation in its context. A session started only to review is fresh and follows every step below. A session that wrote or edited any of the change does steps 1 and 2, then:

- If your tool can start a subagent, start a fresh one and ask it to follow this workflow from step 3. Do not put it on a cheaper model; finding bugs needs more judgment than the risk check. Give it the diff, read access to the repository, the pull request description or the plan, the Code Review Rules in `AGENTS.md` and the risk check's result. Do not give it your conversation, or any account of the change beyond the description or plan. Pass its report on as it came back, with any notes of your own after it, marked as yours.
- Without subagents, do the rest yourself and report `Bug review: by the author`.

1. **Target.** Resolve it as `SKILL.md` describes. For a local review, read the merge-base diff from the chosen base through `HEAD`, then staged, unstaged and untracked changes. Do not fetch or switch branches to resolve it. If the base ref is behind its remote, say so in the report, because the diff will then include other merged work.
2. **Risk check, blind.** Do this before you read the pull request description, so the author's risk box cannot steer the result.
   - If your tool can start a subagent, start one on a cheaper model (Haiku in Claude Code). Give it the diff, read access to the repository, and the label and level definitions from the opening comment of `.github/pull_request_template.md`. Do not give it the description or the commit messages.
   - Ask it for each label that applies, the level, and one `path:line` per label that shows why. When unsure it picks the higher level.
   - Without subagents, classify the diff yourself before you read the description.
   - The check is blind only if the classifier never had the description in its context. Otherwise report it as not blind; it then does not count as a risk assessment.
3. **Intent.** Now read the pull request description, or the plan in `.drakom-ai/plans/` that the change implements. Findings are measured against what the change set out to do.
4. **Review.** Apply the Code Review Rules in `AGENTS.md`, and the rule files it routes for the changed paths. Read the call sites and tests around each change, not only the changed lines. When the diff changes `AGENTS.md`, a rule, a skill, a test or a CI workflow, judge it against the base branch's version of those files and against what the user asked for, because the change may weaken the policy it is being judged by. When the credentials label applies, also run a security review of the diff (`/security-review` in Claude Code).
5. **Verify.** Run the four verification commands in `AGENTS.md` on the reviewed state, or state which were not run and why. Confirm each finding by reading the surrounding code or reproducing it, and drop any you cannot confirm. Confirm the risk check's evidence the same way, then compare its result with the risk box. A box that claims a lower level, or leaves out a label that applies, is an important finding. The higher level wins, including any label your own reading adds. If there is no description yet, report the level and labels so the author can write the box from them.
6. **Report**, in this order:
   - `Recommendation:` the first of these that applies. It follows from the findings; do not choose it freely.
     - `Rethink the approach`: this is a third round and important findings are still open.
     - `Fix before merge`: one or more important findings are open.
     - `Could not judge`: a verification command did not run, or part of the diff was not read. Say what is missing.
     - `Ready to merge`: no important findings, and all four verification commands ran and passed on the reviewed state.
   - `Reviewer: <model family> <variant> (<model identifier>)`, as specific as the runtime exposes; do not guess the variant.
   - `Reviewed: base <SHA>, head <SHA>`, then either `clean checkout` or the staged, unstaged and untracked paths that were included. A SHA alone does not identify a dirty working tree.
   - `Risk check: blind` or `Risk check: not blind`, then the level and labels it gave and the level the risk box claims.
   - `Bug review: fresh` or `Bug review: by the author`, as defined above.
   - The counts: `<n> important, <n> nit, <n> pre-existing`.
   - **Important**: wrong behavior, loss of a user's file, a false statement in shipped text, a broken release, or a risk box that claims too little. **Nit**: worth fixing but not blocking, three at most. **Pre-existing**: a real bug the diff did not introduce. Style is Biome's job and is not reported. A finding you want addressed before merge is important; do not file it as a nit to keep the recommendation positive.
   - For each finding: file and line, the scenario that breaks, and the fix. When it is one of a kind, name the kind and list every instance.
   - The verification results.
   - The recommendation is advice. Whether to merge is the user's decision, and it never counts as an approval.
7. **Re-review.** For each round of fixes, the author starts a new fresh reviewer as described above, rather than resuming the last one, and gives it the round number and the important findings still open from the last report. Review the changes since the last review and the behavior they affect, including callers and tests outside the changed lines. Always list every important finding that is still open, with a note that it was reported before. On a third round with important findings still open, recommend `Rethink the approach` and stop proposing further automatic fix rounds; the open findings stay in the report.

Report only. Posting comments, creating a review on GitHub, or committing fixes needs the user's go-ahead first, because others see those and they are hard to retract.

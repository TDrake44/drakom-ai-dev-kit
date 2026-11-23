# Report

Give the report in this order.

1. `Recommendation:` the first of these that applies. It follows from the findings; do not choose
   it freely.
   - `Rethink the approach`: this is a third round and important findings are still open.
   - `Fix before merge`: one or more important findings are open.
   - `Could not judge`: a verification command did not run, or part of the diff was not read. Say
     what is missing.
   - `Ready after a manual check`: no important findings and every command passed, but the change
     touches something on the repo's manual-checks list. Only when that list exists.
   - `Ready to merge`: no important findings, and every verification command ran and passed on
     the reviewed state.
2. `Reviewer: <model family> <variant> (<model identifier>)`, as specific as the runtime exposes;
   do not guess the variant.
3. `Reviewed: base <SHA>, head <SHA>`, then `clean checkout` or the staged, unstaged and untracked
   paths that were included. A SHA alone does not identify a dirty working tree.
4. `Risk check: blind` or `Risk check: not blind`, then the level and labels it gave and the level
   the risk box claims. In fix rounds, the combined result as `references/fix-rounds.md` describes.
5. `Bug review: fresh` or `Bug review: by the author`.
6. `Manual check:` what needs a person's check, or `not needed`. Only when the repo has a
   manual-checks list.
7. `Rules: repo` or `Rules: defaults`, the latter when the repo has no review rules.
8. The counts: `<n> important, <n> nit, <n> pre-existing`.
9. The findings, each with file and line, the scenario that breaks, and the fix. When a finding is
   one of a kind, name the kind and list every instance, so one fix covers them all.
10. The verification results: each command and whether it passed, failed or did not run.
11. In fix rounds, when a kind of finding came back across rounds, one line naming it and where it
    could be stopped at its source: a test, a lint rule or a review rule.

## Severity

- **Important**: wrong behavior, lost data or files, a false claim in the description, docs or
  comments, a broken build or release, or a risk box that claims too little. The repo's review
  rules give the examples that matter most there. A finding you want addressed before merge is
  important; do not file it as a nit to keep the recommendation positive.
- **Nit**: worth fixing but not blocking. Three at most; in fix rounds, three across all rounds,
  with duplicates removed.
- **Pre-existing**: a real bug the diff did not introduce. Listed, never fixed in this change.

"No findings" is a valid result. The recommendation is advice: whether to merge is the user's
decision, and it never counts as an approval.

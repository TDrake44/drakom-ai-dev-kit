---
"@drakom/ai-dev-kit": minor
---

Adds the `drakom-pr` skill, installed with `npx skills add TDrake44/drakom-ai-dev-kit` (the CLI does not install it). It opens a pull request on GitHub for the current branch and nothing else: a risk check from the diff alone, a description from the repo's pull request template (found in `.github/`, the root or `docs/`) counted against its word budget, and the link recorded in the work's plan as a `**Pull request:**` line. Before pushing it asks about an unmet acceptance criterion, a change over about 1,000 lines with no reason given, or a review the repo requires. When the repo has no template, or one with no visible risk heading or box, it offers once to add its starter template, or only the starter's risk section, and records your answer in `.drakom-ai/rules/pr.md`. Pull requests open ready for review unless that file asks for drafts. It never merges, replies, resolves threads or edits the pull request once open.

`drakom-review` now finds the template's risk labels in the same three places, adds an **other code** label (Medium) to its defaults, and at the end of every run, `fix` runs included, offers what has not run: fix rounds, posting, or `drakom-pr` when nothing important is open and there is no pull request yet.

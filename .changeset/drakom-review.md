---
"@drakom/ai-dev-kit": minor
---

Adds the `drakom-review` skill, installed with `npx skills add TDrake44/drakom-ai-dev-kit` (the CLI does not install it). It reviews a pull request or a local branch against the repo's own review rules and verification commands: a blind risk check, a bug review by a fresh reviewer, and a report of confirmed findings with a recommendation. `drakom-review fix` runs up to three rounds of review, fix and re-review. A reviewer never edits while it reviews. Neither mode pushes or posts, and fix rounds commit only when the user or the repo's rules allow it. A repo with no review rules, verification commands or PR template gets stated defaults.

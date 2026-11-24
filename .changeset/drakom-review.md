---
"@drakom/ai-dev-kit": minor
---

Adds the `drakom-review` skill, installed with `npx skills add TDrake44/drakom-ai-dev-kit` (the CLI does not install it). It reviews a pull request or a local branch against the repo's own review rules and verification commands: a risk check from the diff alone, a bug review by a reviewer that did not write the change, and a report of confirmed findings with a recommendation. `drakom-review fix` runs up to three rounds of review and fixes. By default fix rounds may commit and do nothing more; a repo can change that in `.drakom-ai/rules/review.md`. A repo with no review rules, verification commands or PR template gets stated defaults.

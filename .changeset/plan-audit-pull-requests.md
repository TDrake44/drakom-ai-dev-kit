---
"@drakom/ai-dev-kit": minor
---

`drakom-plan-audit` now reads each plan's `**Pull request:** <url>` lines, which `drakom-pr` writes, and checks their state with `gh pr view`. When the last listed pull request has merged and none is open, it proposes setting the status to `Done: merged in #<number> (<date>)`. A Done plan with a pull request still open is reported, and a plan whose last pull request closed without merging is asked about. A cleanup also offers to delete each plan whose pull requests merged, or move it to `.drakom-ai/specs/`. It changes no status, and deletes or moves none of these plans, without a yes. Pull requests cited anywhere else in a plan are ignored. A link `gh` cannot check is reported as unchecked, and plans without the line get the same checks as before.

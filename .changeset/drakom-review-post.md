---
"@drakom/ai-dev-kit": minor
---

`drakom-review post` posts the final report to the pull request as one GitHub review, laid out like Copilot's: a status, the open issues linked to inline comments with suggestion blocks where a fix is exact, and collapsible sections for what changed, risk and checks. It posts as a comment, never an approval. The recommendations now read `Changes recommended`, `Needs a closer look`, `Approval recommended` and `Rethink the approach`, and a review run without `fix` or `post` ends by offering whichever fits.

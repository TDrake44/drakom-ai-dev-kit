---
"@drakom/ai-dev-kit": minor
---

`drakom-review post` posts the final report to the pull request as one GitHub review, laid out like Copilot's: a status heading, an expanded list of open issues with small badge chips linked to inline comments, suggestion blocks where a fix is exact, and collapsed sections for pre-existing bugs, what changed and checks. It posts as a comment, never an approval. The recommendations now read `Changes recommended`, `Needs a closer look`, `Approval recommended` and `Rethink the approach`; a review run without `fix` or `post` ends by offering whichever fits; and a missing risk box is a finding only where the repo's PR template has one.

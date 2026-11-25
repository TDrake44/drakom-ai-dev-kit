---
"@drakom/ai-dev-kit": patch
---

`drakom-review` says plainly that `post` and pull requests by number are for GitHub only: it checks that `gh` is signed in and the remote is on GitHub before reviewing, and otherwise offers a local review. The blind risk check runs on the cheap tier your review rules name for the tool, passed by name and never the tool's default; with none named it uses Claude's `haiku`, or asks. The reviewer's model is shown by family and tier, with no effort or tool name. Posted reviews follow one section order, post at once when they have no inline comments, put a description fix's corrected text in a code block so inline code survives, and list a description fix made since the last review as fixed in the description. Threads an earlier run already resolved are left alone, and the risk check reads only the pull request's base, head and diff, not its description.

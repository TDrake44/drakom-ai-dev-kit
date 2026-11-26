---
name: drakom-plan-audit
description: Audit or clean up ignored local plans when explicitly requested, such as after pull requests merge. Find stale status, broken links, obsolete plans, and plans whose pull request merged; ask before deleting uncertain plans. Do not use for ordinary scoped planning.
---

# Plan Audit

Paths are relative to the repository root. Use this skill only for an explicit
audit or cleanup of `.drakom-ai/plans/`.

Expect each plan to start with a title, then `**Status:** <word>: <one line>`
(word is Active, Next, Later, or Done) and `**Synopsis:**`. A missing header is
a finding, not an error: offer to add or fix it, and never delete a plan for it.

Before reading large plans, inventory plan names, sizes, status headers,
incoming links, and the `**Pull request:** <url>` lines among the paragraphs
after the header. Only those lines count; ignore a pull request cited anywhere
else. Check material status claims against the current worktree, code, tests,
documentation, and relevant commits. Classify each plan as current, deferred
but useful, completed history, superseded, or uncertain. Read only the sections
needed to justify that classification.

A plan without the line gets these checks unchanged and no `gh` call. For each
URL, run `gh pr view <url> --json state,mergedAt`. If the last listed pull
request merged, none is open, and the status is not Done, propose Done, as
`Done: merged in #<number> (<date>)`. A Done plan with a listed pull request
still open is a finding. If the last one closed without merging, the plan is
uncertain, so ask. When `gh` is missing or not logged in, or the URL is not a
GitHub pull request, report that link as unchecked and finish the other checks;
never infer its state from the plan's text.

For an audit request, report findings and proposed actions without deleting or
editing. On a yes to Done, change only the status line. For a cleanup request,
also offer to delete each plan whose pull requests merged, or move it to
`.drakom-ai/specs/`; act only on a yes. Delete other clearly completed or
superseded local plans after preserving unique decisions in the remaining local
context and repairing links. Ask the user which
uncertain plans still matter before deleting them; absence of an answer is not
approval. Verify remaining relative links, list retained and deleted plans, and
report that ignored-file deletions do not appear in Git status.

---
name: drakom-plan-audit
description: Audit or clean up ignored local plans when explicitly requested. Find stale status, broken links, and obsolete plans; ask before deleting uncertain plans. Do not use for ordinary scoped planning.
---

# Plan Audit

Paths are relative to the repository root. Use this skill only for an explicit
audit or cleanup of `.drakom-ai/plans/`.

Inventory plan names, sizes, status headers, active-step pointers, and incoming
links before reading large plans. Check material status claims against the
current worktree, code, tests, documentation, and relevant commits. Classify
each plan as current, deferred but useful, completed history, superseded, or
uncertain. Read only the sections needed to justify that classification.

For an audit request, report findings and proposed actions without deleting.
For an authorized cleanup, delete clearly completed or superseded local plans
after preserving unique decisions in the remaining local context and repairing
links. Ask the user which uncertain plans still matter before deleting them;
absence of an answer is not approval. Do not promote plans into tracked specs
unless the user explicitly asks.

Verify remaining relative links, list retained and deleted plans, and report
that ignored-file deletions do not appear in Git status.

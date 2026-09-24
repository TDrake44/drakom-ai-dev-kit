---
name: pr-review
description: Review a pull request or local branch diff against repository rules and safety constraints, then report severity-ranked findings and verification results.
---

# PR Review Skill

Resolve the review target before inspecting changes. If the user invokes
`$pr-review` without a PR, review mode, or base branch, ask them to choose:

1. A pull request link or number.
2. Local changes compared with `main`.
3. Local changes compared with another named base branch.

If local review is requested without a base, ask whether to use `main` or a
different exact ref. Do not infer a remote PR or silently choose a comparison
scope.

Execute the review process defined in `.agents/skills/pr-review/workflow.md`.
Never modify code or commit changes autonomously while running this skill.

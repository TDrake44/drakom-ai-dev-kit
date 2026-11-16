---
name: dev
description: Implementation driver executing features and bug fixes using Test-Driven Development loops against established plans and rules.
---

<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->


# Dev Skill

## Preparation
1. Use an existing plan in `.drakom-ai/plans/` or `.drakom-ai/specs/` when one applies. Otherwise, derive acceptance criteria from the user's request and repository evidence. Do not require or create a plan solely to use this skill.
2. Load only the necessary rules: `.drakom-ai/rules/coding.md` and `.drakom-ai/rules/testing.md`.
3. Work on one pull request at a time. When the plan lists several, do only the next one. If the work grows past that pull request's purpose, or past the size limit in `AGENTS.md`, stop before going on: propose a new split to the user, or say why it should stay one pull request.

## Execution Loop (TDD)
1. Write failing tests covering the acceptance criteria from the plan or request.
2. Confirm the new tests fail. Tests import `dist/`, so build first: `pnpm build && node --test <file>` for one file, or `pnpm run test` for everything.
3. Implement minimal viable code passing the tests.
4. Refactor, following `.drakom-ai/rules/coding.md`.
5. Run the four verification commands in `AGENTS.md`.
6. Re-read the whole diff against the acceptance criteria and the Code Review Rules in `AGENTS.md`, and fix what you find. Add a changeset and update docs where `AGENTS.md` requires them.
7. Report what changed, the verification output, anything left undone, and the part of the change most worth a human look.

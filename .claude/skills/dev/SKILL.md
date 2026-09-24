---
name: dev
description: Implementation driver executing features and bug fixes using Test-Driven Development loops against established plans and rules.
---

<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->


# Dev Skill

## Preparation
1. Use an existing plan in `.drakom-ai/plans/` or `.drakom-ai/specs/` when one applies. Otherwise, derive acceptance criteria from the user's request and repository evidence. Do not require or create a plan solely to use this skill.
2. Load only the necessary rules: `.drakom-ai/rules/coding.md` and `.drakom-ai/rules/testing.md`.

## Execution Loop (TDD)
1. Write failing tests covering the acceptance criteria from the plan or request.
2. Run test suite to verify test failure (`pnpm test`).
3. Implement minimal viable code passing the tests.
4. Refactor while strictly conforming to Prohibited Patterns in `.drakom-ai/rules/coding.md`.
5. Run linting and typecheck verification commands.

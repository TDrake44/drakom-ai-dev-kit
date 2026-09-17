---
name: dev
description: Implementation driver executing features and bug fixes using Test-Driven Development loops against established plans and rules.
---

<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "pnpm skills:sync" to update. -->


# Dev Skill

## Pre-requisites
1. Ensure a plan exists in `.ai/plans/` or `.ai/specs/`.
2. Load only the necessary rules: `.ai/rules/coding.md` and `.ai/rules/testing.md`.

## Execution Loop (TDD)
1. Write failing tests covering the acceptance criteria defined in the active plan.
2. Run test suite to verify test failure (`pnpm test`).
3. Implement minimal viable code passing the tests.
4. Refactor while strictly conforming to Prohibited Patterns in `.ai/rules/coding.md`.
5. Run linting and typecheck verification commands.

---
"@drakom/ai-dev-kit": minor
---

Adds the `drakom-plan` skill, installed with `npx skills add TDrake44/drakom-ai-dev-kit` (the CLI does not install it). It turns a request, ticket or issue into a plan file in `.drakom-ai/plans/` before any code is written. By default it interviews you on the open decisions in rounds, each question with its recommended answer, and records your answers in the plan as it goes; `drakom-plan quick` skips the interview. When the work outgrows one pull request, it says so and offers to split the plan into an overview and one plan per piece, in merge order. In a repository with no `.drakom-ai/`, it creates only `.drakom-ai/.gitignore` (ignoring `plans/` and `assets/`) and the plan, and checks that Git ignores `plans/`. It ends by offering `drakom-dev`, here or in a fresh session through `drakom-handoff` when those are installed, and starts nothing without your yes. The interview is adapted from Matt Pocock's `grilling` skill (MIT).

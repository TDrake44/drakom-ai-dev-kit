# Elevated Architecture Specifications

This folder contains git-tracked, version-controlled architecture specifications.

## Plan Elevation Criteria
- Scratchpad plans in `.drakom-ai/plans/` are local-only and gitignored.
- A plan must be moved or copied to `.drakom-ai/specs/<feature>.md` and committed when:
  1. Multiple engineers need to collaborate on the implementation.
  2. The architectural changes impact cross-team contracts or public APIs.
  3. Long-term historic decision logging (ADR style) is required by the team.

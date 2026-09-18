# Elevated Architecture Specifications

This folder contains git-tracked, version-controlled architecture specifications.

## Plan Elevation Criteria

- Scratchpad plans in `.drakom-ai/plans/` are local-only and gitignored.
- Move or copy a plan to `.drakom-ai/specs/<feature>.md` and commit it when:
  1. Multiple engineers need to collaborate on the implementation.
  2. Architectural changes affect cross-team contracts or public APIs.
  3. The team needs a durable historic decision record, such as an ADR.

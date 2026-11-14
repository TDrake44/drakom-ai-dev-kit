# Elevated Architecture Specifications

This folder contains git-tracked, version-controlled architecture specifications.

## Plan Header

Start every plan in `.drakom-ai/plans/`, and every spec, with:

```
# <Title>

**Status:** <word>: <one line on where it stands>

**Synopsis:** <what the plan is for, in 1-2 short sentences>
```

The word is **Active** (being worked on), **Next** (queued), **Later** (parked) or **Done** (finished or superseded). Update the status when the plan's state changes.

## Plan Elevation Criteria
- Scratchpad plans in `.drakom-ai/plans/` are local-only and gitignored.
- A plan must be moved or copied to `.drakom-ai/specs/<feature>.md` and committed when:
  1. Multiple engineers need to collaborate on the implementation.
  2. The architectural changes impact cross-team contracts or public APIs.
  3. Long-term historic decision logging (ADR style) is required by the team.

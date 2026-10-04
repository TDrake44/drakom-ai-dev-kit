# Project Context Adoption Plan

## Context

- Repository evidence:
- Existing agent context:
- Native verification commands:
- Constraints and unknowns:

## Assessment Entries

List every relevant source, or a bounded group of related sources, under Keep, Refine, Add, or Omit. Include `.drakom-ai/plans/` and `.drakom-ai/specs/` even when search tools skip them because of `.gitignore`. Record each entry with these fields:

- Source path and evidence:
- Ownership (kit-managed, generated, project-owned, unmanaged, or unknown):
- Decision and rationale:
- Destination or action (including "keep in place"):
- Dependencies (routes, scripts, companion files):
- Approval status:
- Verification:

## Keep

- Existing context to preserve unchanged.

## Refine

- Existing context to revise, and the exact owned file.

## Add

- Proposed rule, skill, or router change. Draft rules from `.agents/skills/drakom-ai-setup/references/rule-anatomy.md`.

## Omit

- Considered additions or existing context that do not justify their maintenance cost. Omit never means delete; omitted files stay in place unless removal is separately approved.

## Proposed Files and Interfaces

- Exact path:
- Ownership category:
- Inputs, outputs, and callers:

## MCP Decisions

- Repository-local sources inspected:
- Import, override, preserve-unmanaged, or skip decision:
- Conflicts or credential risks (never include secret values):

## Verification

- Paths to validate:
- Commands to run:
- References and skill names to resolve:

## Approval Gate

No project-owned rule, skill, entry-point prose, or MCP source changes occur until the user explicitly approves the exact items above.

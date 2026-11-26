# Project rules

Any rule file can go in this folder, such as a coding, testing or security rule, named by its
scope. The drakom skills load it when something routes to it: a line in the "Topic rules" list
below, or a route in `AGENTS.md` or `CLAUDE.md`, which works the same. A repo that already routes
its rules there can leave the list empty. Add a rule only for a stable policy that the formatter,
linter, type checker or tests do not already enforce.

## Topic rules

One line per rule file, with when to load it, such as `coding.md`: when writing or changing code.
The list starts empty.

## Extension files

Six names are kept for the drakom skills, which find these files by name, with no route. Each is an
optional bonus: without it, the skills use their own defaults. Their lines add to a skill's steps
and cannot switch one off.

- `verification.md`: commands to run before work counts as done, including how to run one test,
  and manual checks that need a person, such as a look on a phone. Read by drakom-dev and
  drakom-review, and by drakom-pr for the manual checks. Without it, the commands in `AGENTS.md` or
  `CLAUDE.md`, else the package scripts, Makefile or CI.
- `review.md`: what a review checks here, and the cheap model tier for the blind risk check. Read
  by drakom-review, by drakom-dev when it re-reads its own diff, and by drakom-pr for the risk-check
  tier. Without it, a `## Code Review Rules` section in `AGENTS.md` or `CLAUDE.md`, else three
  rules that apply anywhere: a claim nothing backs, an input the author did not try, and a stated
  risk that claims too little.
- `plan.md`: steps a repo adds to planning, such as a section every plan needs. Read by drakom-plan.
  Without it, the skill's own steps.
- `dev.md`: steps a repo adds to building a change, such as branch and commit conventions. Read by
  drakom-dev. Without it, the conventions in `AGENTS.md` or `CLAUDE.md`, else the recent `git log`.
- `pr.md`: pull request habits, such as opening drafts, branch, title and commit conventions, and a
  review required before opening. It also records the answer to the template offer, as
  `PR template offer: yes` or `PR template offer: no`. Read by drakom-pr. Without it, the
  conventions in `AGENTS.md` or `CLAUDE.md`, else the recent `git log`, and ready for review.
- `handoff.md`: what a handoff prompt for a fresh session adds. Read by drakom-handoff. Without it,
  the skill's own steps.

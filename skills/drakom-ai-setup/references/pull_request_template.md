<!--
About 200 words outside these comments; count them before opening. Count words, not lines, and
keep each bullet to one short line. A large change may run longer: keep Reviewer focus short and
put the extra in Summary. Say what a user would see. Every sentence is a claim the reviewer will
check; history and step-by-step detail go in commits or the plan. These comments don't render.

Risk labels (a repo replaces these with its own); name each that applies:
  credentials: touches secrets, tokens or how credentials are handled
  user data: changes what is stored for users, or its shape
  agent instructions: AGENTS.md, CLAUDE.md, rules or skills
  weakens a check: changes or removes a test, lint rule, type check or CI step
  other code: any other change to code, its dependencies or its build
Levels; the highest wins, and when unsure pick the higher:
  🔴 High: read closely. Credentials or user data.
  🟡 Medium: read the focus. Agent instructions, weakens a check or other code.
  🟢 Low: skim. None of the above, such as docs people read, comments and typos.
The Risk line is a quick eye catch: the level and the label names, nothing more. Paths and reasons
go in Reviewer focus. With no label, write "No label". The second line, in <sub>, says who assessed
it: the model family and tier, such as "GPT-6 Luna" or "Claude Haiku"; without a fresh context,
"Assessed by the author, not blind." Every level still needs a person's approval.
-->

## Risk

🔴 **High: read closely.** Credentials, user data.
<sub>Assessed by … from the diff alone, in a fresh context. A starting point, not a verdict.</sub>

## Reviewer focus

<!-- Up to three judgment calls a person should check, one line each, with `path:line` and the
choice this pull request makes. Then a "Not done:" line per requirement left out, with why, and
how to undo it: "revert", or what a revert leaves behind (a release already published, data
already migrated) and how to put that right. -->

- …
- Undo: …

## Summary

<!-- Why, in one or two plain sentences. Then one line per change. -->

## Evidence

<!-- What shows it works and its result; for a fix, that the test failed first. Name the checks
CI runs only when one couldn't run, and a manual check when one was needed. The review: tool,
commit read, fresh or by the author, rounds run and important findings still open. "Not covered:"
what no test exercises. -->

- Review: …

<!--
Write for a reader who has two minutes and has not opened the code. About 20 rendered lines.
Plain words first: say what a user of the kit would see. Name files and functions only under
"Where to look". Every sentence is a claim the reviewer will check; history, alternatives and
step-by-step detail belong in commits or the plan. These comments do not render.

The risk box comes first. Name each label that applies:
  consumer files: writes, overwrites or deletes files in a consumer's repo
  what ships: `payload/v1/**`, publish fields, release or CI workflows
  credentials: touches credential handling
  agent instructions: `AGENTS.md`, rules, skills
  weakens a check: changes or removes an existing test, lint rule or type check
Then set the level and keep the marker that matches it; GitHub colours the box:
  High, `[!CAUTION]`, red: consumer files, what ships or credentials
  Medium, `[!WARNING]`, yellow: agent instructions, weakens a check, or any other change to
    `src/` or the dependencies
  Low, `[!NOTE]`, blue: none of the above, such as docs people read, comments and typos
The highest level wins; when unsure, pick the higher. With no label, write "no label". The level
is a claim the reviewer checks, and every level still needs a person's approval.
-->

> [!CAUTION]
> **Risk: High** · labels · because …

## What changes

<!-- What the kit did before, what it does now, and why, in two or three sentences. For several
separate changes, one line each. -->

## Needs your decision

<!-- What only a person can settle: scope, a trade-off, a stopgap, a pattern later work will copy.
One line each, ending with the choice this pull request makes. "Nothing" is an answer. -->

1.

## Where to look

<!-- Up to three places where a mistake would cost the most: `path:line`, what the code there
does, and what to check. "Nothing stands out" is an answer.
Proved by a check: parts a named check already covers, such as synced copies under
`.agents/skills/` (`pnpm sync:check`) or the lockfile. Leave the line out when there are none. -->

1.

Proved by a check: …

## Undo and limits

<!-- Undo: "revert this pull request", or what a revert leaves behind (a published version, files
already written into consumer repos) and how that is put right.
Not covered: what no test exercises and what was left out on purpose. "Nothing" is an answer. -->

- Undo: …
- Not covered: …

## Evidence

<!-- Tested: what shows the change does what "What changes" says: the test or command and its
result; for a fix, that the test failed before it. CI runs `pnpm lint`, `pnpm typecheck`,
`pnpm test` and `pnpm sync:check` on every pull request, so list those only when one could not run.
A review run locally leaves no trace on GitHub, so if one ran, add the tool, the commit it read
and the findings still open.
Changeset: "added", or "not needed" for docs, tests and internal configuration. -->

- Tested: …
- Changeset: …

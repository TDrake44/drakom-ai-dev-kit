<!--
Write for a reader with two minutes: 15 rendered lines or fewer. Every sentence here is a claim the
reviewer has to check. History, alternatives and step-by-step detail belong in commits or the plan.
These comments do not render; leave them or delete them.
-->

## What and why

<!-- Two or three sentences: what changes for a user or maintainer, and why. -->

## Read first

<!-- Up to three places where a mistake would cost the most: `path:line`, then the question to ask
there. Write "Nothing stands out" when that is true. -->

1.

## Risk and limits

<!-- Risk names each consequence that applies, or "none": writes, overwrites or deletes files in a
consumer's repo; changes what ships (`payload/v1/**`, publish fields, release or CI workflows);
touches credential handling; changes instructions agents follow (`AGENTS.md`, rules, skills);
weakens a check (tests, CI, lint config). The reviewer checks this like any other claim.
Not covered is what was not tested or was left out on purpose; "nothing" is an answer. -->

- Risk: … because …
- Not covered: …

## Checks

<!-- Changeset: "added", or "not needed" for docs, tests and internal configuration.
Reviewed: tool and model, base SHA, head SHA, clean or dirty tree, findings found and still open;
"not yet" until a review has run, and update it after a review of later commits.
Plan or issue: a link, "Closes #123", or "none". -->

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm run test` and `pnpm sync:check` pass locally
- Changeset: …
- Reviewed: …
- Plan or issue: …

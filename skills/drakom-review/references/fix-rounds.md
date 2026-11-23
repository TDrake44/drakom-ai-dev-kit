# Fix rounds

With the argument `fix`, review, fix and re-review for up to three rounds. The reviewer and the
fixer are never the same agent, so no one reviews their own fixes.

## Each round

1. **Risk check** on the current diff, as `references/risk-check.md` describes. A fix can touch a
   new area, so it runs every round.
2. **Review.** A new fresh reviewer reviews the current state, as `references/fresh-reviewer.md`
   describes. It stays read-only.
3. **Fix.** The calling session, which is the author, fixes the important findings, then runs the
   verification commands. Nits and pre-existing bugs are listed, not fixed. Changes stay in the
   working tree unless the user or the repo's rules allow commits. Never push or post.
4. The next round re-reviews the fixes and the behavior they affect.

Without subagents, the author reviews every round itself, rather than offering a fresh session
each round, and every round is reported `Bug review: by the author`.

## Acceptance criteria

An unmet criterion is never built by default. Before tagging one, read the plan, the ticket and
the description for a recorded reason. A finding for a criterion with no recorded reason goes to
the user: meet it, or give the reason. That reason goes to the next round's reviewer and into the
pull request description.

## Stop when

- no important finding is open: done;
- a third round still has important findings: `Rethink the approach`, with the open findings
  listed;
- a fix would change the scope or a decision the user made: ask the user;
- the author believes a finding is wrong: leave it unfixed and say why;
- the risk level rises between rounds: say so and ask the user before going on.

## Risk across rounds

Combine the rounds by taking the highest level and every label any round found, never an
average: the levels are ordered, and the costly mistake is claiming too little. When rounds
disagree, say so in the report, because the change then needs a careful human read.

## Final report

One report, as `references/report.md` describes, with the rounds run, the findings fixed in each,
every finding still open and the combined risk.

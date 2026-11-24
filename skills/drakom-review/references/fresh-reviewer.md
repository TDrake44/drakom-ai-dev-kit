# Fresh reviewer

A session that wrote or edited any of the change hands the bug review (steps 3 to 6) to a
reviewer that never saw the author's conversation.

## With subagents

Start a fresh subagent on a full model, not a cheaper one: finding bugs needs more judgment than
the risk check. Ask it to follow this skill from step 3, and give it:

- the target from step 1: base and head SHAs, the staged, unstaged and untracked paths included,
  and whether the base is behind its remote;
- a checkout that holds the reviewed state, where it can run the verification commands;
- the pull request description or the plan, and any ticket it links;
- where the review rules and topic rules are;
- the risk check's result and whether it was blind;
- on a re-review: the round number, the last report's `Reviewed:` line, the important findings
  still open from it, and any reason the user gave for leaving a finding or a criterion unmet.

Do not give it your conversation, or any account of the change beyond the description, plan or
ticket. Pass its report on as it came back, with any notes of your own after it, marked as yours.

For each round, start a new reviewer rather than resuming the last one. It reviews the changes
since the last review and the behavior they affect, including callers and tests outside the
changed lines, and lists every important finding still open, with a note that it was reported
before.

## Without subagents

In fix rounds, the author reviews each round instead, as `references/fix-rounds.md` describes.
Outside them:

Offer the user a fresh session for the review. Write a short prompt they can paste into it: run
this skill on the target (base and head SHAs, the working-tree paths included), the description or
plan to read, the risk check's result and whether it was blind, and on a re-review the round
details above. Leave out any account of how the change was written.

If the user would rather not start one, do the rest yourself and report `Bug review: by the
author`.

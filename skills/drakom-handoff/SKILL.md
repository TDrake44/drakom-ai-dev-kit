---
name: drakom-handoff
description: Write a prompt that a fresh session, with none of this conversation, can start from to pick up the next step of the current work, printed in the chat for the user to copy. Use when the user asks for a handoff or a prompt for a new session.
---

# Handoff

Write a prompt a fresh session can start from. It has none of this conversation, so the prompt
gives the goal, the next step and how to tell it is done, what is decided and what is open, and
what is done and should not be redone. If the user says what the next session is for, write it for
that.

- Point to plans, specs, issues, commits and diffs by path or URL; don't copy them.
- Name the skill the next session should run, when that skill is installed.
- Don't write a belief as a fact: say what was checked and what was only assumed.
- Leave out secrets, such as keys, tokens and passwords, and personal details.
- When a plan in `.drakom-ai/plans/` exists for this work, update its status line first. Never
  create a plan. A decision that changes the plan's scope, decisions or acceptance criteria goes in
  only with the user's yes; otherwise it goes in the prompt.
- When another skill asks for the prompt with a fixed list of what it holds, hold that list and
  nothing else, and leave the plan as it is.
- Lines in `.drakom-ai/rules/handoff.md`, when present, add to these.

Print the prompt in the chat as one fenced block for the user to copy, using a longer fence than
any inside it. After it, say only whether the plan's status line changed. Don't start the session.

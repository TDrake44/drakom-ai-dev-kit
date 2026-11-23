# Risk check

The check classifies the diff before anyone reads the description, so the author's risk box
cannot steer the result.

## Procedure

1. **Classifier.** If the tool can start a subagent, start one on a cheaper model (Haiku in
   Claude Code, for example). Give it the diff, read access to the repository, and the label and
   level definitions: the repo's own, from the opening comment of its PR template, or the defaults
   below. Do not give it the pull request description, the plan or the commit messages. Without
   subagents, classify the diff yourself before reading any of those.
2. **Ask** for each label that applies, the level, and one `path:line` per label that shows why.
   When unsure, it picks the higher level.
3. **Blind or not.** The check is blind only if the classifier never had the description, the plan
   or the commit messages in its context. Otherwise report it as not blind; it then does not count
   as a risk assessment.
4. **Confirm** each label's evidence by reading the cited line. Keep a label your own reading adds.
   The highest level of any confirmed label is the result.

## Default labels

Used when the repo's PR template has no risk labels of its own.

- **credentials**: touches secrets, tokens or how credentials are handled.
- **user data**: changes what is stored for users, or its shape.
- **agent instructions**: `AGENTS.md`, `CLAUDE.md`, rules or skills.
- **weakens a check**: changes or removes a test, lint rule, type check or CI step.

## Default levels

The highest level that applies wins; when unsure, pick the higher.

- **High**: read closely. Credentials or user data.
- **Medium**: read the focus. Agent instructions, weakens a check, or any other code change.
- **Low**: skim. None of the above: docs, comments, typos.

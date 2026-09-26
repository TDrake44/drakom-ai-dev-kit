---
"@drakom/ai-dev-kit": minor
---

- Rename the optional `plan-audit` skill to `drakom-plan-audit`.
- Existing 0.2.0 installs should remove the old skill and its `managedFiles` entry in `.drakom-ai/state.json`, then run `drakom-ai init --with-plan-audit`; sync reports a conflict until then.
- Keep the `--with-plan-audit` flag unchanged.

---
'@drakom/ai-dev-kit': patch
---

Make the starter `.drakom-ai/rules/README.md` and `.drakom-ai/specs/README.md` create-once and project-owned, so editing or deleting them no longer blocks `sync`; the next `sync` drops their old records from `state.json` without touching the files.

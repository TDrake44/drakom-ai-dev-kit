---
'@drakom/ai-dev-kit': minor
---

**Sync preserves local edits and applies unrelated updates.** When conflicts remain, sync exits `2`, even if it updated other files. Use `sync --accept <path>` to keep your edit under kit management. Sync flags it again when a later kit release changes that file. Use `sync --release <path>` to make the file project-owned. Sync warns when a detached file differs from the kit.

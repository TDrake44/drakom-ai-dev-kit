---
'@drakom/ai-dev-kit': minor
---

**Safer sync conflicts.** One edited managed file no longer blocks unrelated updates. Use `sync --accept <path>` to keep an edit or `sync --release <path>` to take ownership. Sync exits `2` while conflicts remain and warns about detached files that differ from the kit.

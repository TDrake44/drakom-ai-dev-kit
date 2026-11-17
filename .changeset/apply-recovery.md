---
'@drakom/ai-dev-kit': patch
---

**Safer writes and recovery.** `init` and `sync` recheck files before rewriting them and stop if they detect an intervening edit. Rewritten files keep their permissions. Before applying changes, the CLI checks that files it plans to rewrite or delete contain valid UTF-8. If a write fails, rollback attempts each remaining recovery step and reports any paths it could not restore.

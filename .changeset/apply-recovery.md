---
'@drakom/ai-dev-kit': patch
---

**Safer failed runs.** A file saved while `init` or `sync` is writing is no longer overwritten, and rewritten files keep their permissions. When a write fails, the rollback now continues past a file it cannot restore and names it, and no temporary file is left behind. A file that is not valid UTF-8 is refused before any write, where a merge used to replace its non-ASCII bytes.

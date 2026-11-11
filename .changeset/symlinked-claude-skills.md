---
'@drakom/ai-dev-kit': patch
---

Accept `.claude/skills` and `CLAUDE.md` symlinks to their canonical targets, report any other symlink as a conflict instead of writing through it, and exit cleanly when `init` gets no answer to its prompt.

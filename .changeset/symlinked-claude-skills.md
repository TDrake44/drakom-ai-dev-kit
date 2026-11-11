---
'@drakom/ai-dev-kit': patch
---

Accept `.claude/skills` and `CLAUDE.md` symlinks to their canonical targets, never write through any other symlink (`init` and `sync` report it as a conflict that says where it points, and applying a plan refuses it as a backstop), and exit cleanly when `init` gets no answer to its prompt.

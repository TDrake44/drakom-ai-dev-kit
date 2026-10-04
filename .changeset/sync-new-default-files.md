---
"@drakom/ai-dev-kit": minor
---

`sync` now installs default files that newer kit releases add, so existing projects receive them without re-running `init`. A new default is created only when the project's recorded kit version predates the release that introduced it and nothing already exists at its path. An unmanaged file at that path is reported as a conflict and nothing is written. A default you delete, together with its state entry, is not offered again. When the new file is a skill, its Claude mirror is generated in the same sync.

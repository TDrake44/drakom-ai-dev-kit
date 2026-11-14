---
'@drakom/ai-dev-kit': minor
---

Stop one edited or deleted kit-managed file from blocking the whole `sync`. A conflict now holds back only its own item: everything else is applied and recorded, and `sync` exits `2` while a conflict remains. Add `sync --accept <path>` to keep a local edit until a later kit release changes that file, and `sync --release <path>` to stop managing a file and leave it as it is. Conflict messages name these next steps, and a kit file that is present but no longer managed is listed as a non-blocking `WARNING`.

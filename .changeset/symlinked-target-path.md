---
'@drakom/ai-dev-kit': patch
---

Accept a target path that is a symlink to a directory for `init` and `sync`. The plan prints the resolved path and the path as typed. A target symlink to a file, or to nothing, now gives an error that names the link and where it points.

---
'@drakom/ai-dev-kit': patch
---

Keep CRLF line endings in target repositories. When `init` or `sync` appends to or rewrites part of a file (the `AGENTS.md` block, the `CLAUDE.md` import, `.worktreeinclude`, a Claude skill mirror, a kit-managed file update, the state file), the new text uses the line ending most of that file's lines already use, so no file ends up with mixed line endings. Kit-managed files, mirrors and the state file that differ from the kit only in CRLF versus LF, as after a Windows checkout with `core.autocrlf`, now count as up to date instead of locally modified.

Existing `state.json` files stay valid. Fingerprints of LF text are unchanged. A fingerprint that an earlier version recorded over CRLF bytes, such as an accepted edit or the mixed-ending mirror of a CRLF skill, still matches on the first `sync` after upgrading; that `sync` records it again in a form that holds on both LF and CRLF checkouts, and rewrites a mixed-ending mirror in its skill's line ending.

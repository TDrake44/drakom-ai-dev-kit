---
'@drakom/ai-dev-kit': patch
---

Keep CRLF line endings in target repositories. When `init` or `sync` appends to or rewrites part of a CRLF file (the `AGENTS.md` block, the `CLAUDE.md` import, `.worktreeinclude`, a Claude skill mirror, a kit-managed file update), the new text uses CRLF too, so no file ends up with mixed line endings. Kit-managed files, mirrors and the state file that differ from the kit only in CRLF versus LF, as after a Windows checkout with `core.autocrlf`, now count as up to date instead of locally modified. Existing `state.json` files stay valid: fingerprints recorded by earlier versions still match.

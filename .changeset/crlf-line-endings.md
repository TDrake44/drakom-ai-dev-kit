---
'@drakom/ai-dev-kit': patch
---

Keep CRLF line endings in target repositories. When `init` or `sync` appends to or updates text (the `AGENTS.md` block, the `CLAUDE.md` import, `.worktreeinclude`, a kit-managed file, the state file), the new text uses the file's majority line ending, with LF on a tie. Claude mirrors follow their canonical skill's line ending. This avoids introducing mixed endings into uniform files; existing user text outside a replaced section keeps its original bytes. Kit-managed files, mirrors and the state file that differ from the kit only in CRLF versus LF, as after a Windows checkout with `core.autocrlf`, now count as up to date instead of locally modified.

Existing `state.json` files stay valid. Fingerprints of LF text are unchanged. Earlier raw-byte fingerprints match unchanged text or its all-CRLF form, including an accepted edit and its kit baseline after an LF checkout. The first `sync` records matching legacy fingerprints again in a form that holds on both LF and CRLF checkouts, and rewrites a mixed-ending mirror in its skill's line ending. A mirror already matching its canonical skill apart from line endings can also be re-recorded. Other legacy mixed-ending records whose original bytes are no longer available remain conflicts; the CLI cannot reconstruct arbitrary old line endings from a hash.

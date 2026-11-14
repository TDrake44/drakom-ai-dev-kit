# Documentation Standards

## 1. Scope
Applies to READMEs, docstrings, architectural specifications, and inline comments.

## 2. Required Patterns
- Markdown documents must use concise scannable lists and explicit tables for comparisons.
- All code snippets in documentation must be syntactically valid and runnable.
- Document reasons and constraints rather than restating self-evident code mechanics.

## 3. Prohibited Patterns
- **No stale commands or flags**: `pnpm` commands must match `package.json` scripts, and `drakom-ai` flags must match `src/cli-help.ts` and `src/cli-arguments.ts`.
- **No Bloated Setups**: Avoid redundant conversational narrative in instruction documents.

## 4. Verification
No markdown linter is configured. Check every command in changed docs against `package.json` scripts, and every referenced path against the working tree.

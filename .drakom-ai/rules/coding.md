# Coding Standards & Architectural Invariants

## 1. Scope
Applies to all source code files across application and script modules.

## 2. Required Patterns
- Explicit typing across all public interface boundaries and function signatures.
- Modules must be structured as ES Modules with strict single responsibility boundaries.
- Defensive argument parsing and clear validation errors on invalid inputs.

## 3. Prohibited Patterns
- **No `any` types**: Never bypass compiler validation using `any` or untyped casts.
- **No Implicit Globals**: Every dependency must be cleanly imported.
- **No Logic in Entry Hubs**: Keep `AGENTS.md` and `CLAUDE.md` as routers, not code dumps.

## 4. Verification
Run:
```bash
pnpm lint
pnpm typecheck
```

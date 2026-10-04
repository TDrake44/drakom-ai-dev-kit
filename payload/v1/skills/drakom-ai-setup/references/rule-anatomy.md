# Rule Anatomy

Use this reference when an approved Add item is a rule in `.drakom-ai/rules/`. A rule records stable policy that changes how an agent implements work in this repository. Recurring procedures belong in skills; one-off knowledge belongs in documentation.

## Anatomy

Every rule file has four sections, in this order:

1. **Scope**: the files, directories, or tasks the rule applies to. Name concrete paths or globs so an agent can tell whether the rule is relevant.
2. **Required Patterns**: the idioms, conventions, and architectural structures this repository expects. State the desired pattern directly; this is where most guidance belongs.
3. **Prohibited Patterns**: failures agents have introduced here, or plausibly would, that formatters, linters, types, and tests do not already catch. Give each prohibition its reason.
4. **Verification**: the repository's actual commands that check compliance, or the manual check to perform when no command exists.

## Budget and Content

- Keep each rule within a budget of 150–200 lines. Split a rule by scope before exceeding it, and move deep-dive material into a companion `<rule>-reference.md` routed on demand.
- Prefer stating the desired pattern under Required Patterns over listing what to avoid.
- Add a prohibition only when the failure is real in this repository: seen in history, review, or incident evidence, or a near-certain consequence of the stack. Each prohibition states its reason so an agent can judge edge cases.
- Omit anything formatters, linters, types, or tests already enforce, unless an agent needs it to choose the correct approach before the tooling runs.
- Use the repository's own vocabulary, paths, and commands. Verify every command against the package manager and scripts that exist.
- Do not copy content from other rules or documentation; link to it.

## Common Rule Types

These are common examples, not a required set. A project may need none of them, or a rule outside this list; name it by its scope. Propose a rule only when repository evidence justifies it.

### Coding

- Justified when: the codebase has architecture boundaries, module conventions, or error-handling and typing policies that tooling does not enforce.
- Skip when: the formatter, linter, and type checker already capture the conventions that matter.

### Testing

- Justified when: the project has a specific framework, fixture or isolation policy, coverage expectation, or test shortcuts it must avoid.
- Skip when: there is no test suite yet, or the runner's defaults and existing tests already demonstrate the conventions.

### Documentation

- Justified when: user-facing docs, API references, or changelogs must stay synchronized with code, or follow a structure agents keep getting wrong.
- Skip when: documentation is minimal or owned outside the repository.

### Domain risk

- Justified when: a mistake in one area causes outsized harm, for example a data-safety rule for migrations, financial calculations, or irreversible deletes.
- Skip when: the risk is hypothetical, or already guarded by code-level checks and tests.

### Security

- Justified when: the repository handles secrets, authentication, untrusted input, or permissions in ways an agent could weaken.
- Skip when: the project has no such surface, or an organization-wide policy already governs it and can be linked instead.

### API contracts

- Justified when: the project publishes interfaces with compatibility promises, such as a public package, HTTP API, schema, or CLI surface.
- Skip when: every consumer lives in the same repository and changes atomically with the interface.

## Worked Example

A short testing rule for a service whose integration tests share one database:

```markdown
# Testing Standards

## 1. Scope
Applies to `tests/**` and test fixtures under `tests/fixtures/`.

## 2. Required Patterns
- Each integration test creates its own records through `tests/fixtures/factory` and removes them in teardown.
- Use the in-memory queue adapter from `tests/support/queue` for job assertions.

## 3. Prohibited Patterns
- **No shared seed records**: tests that read or mutate the shared seed data fail intermittently when run in parallel.
- **No fixed sleeps**: waiting on timers made the job suite flaky; poll for the expected state instead.

## 4. Verification
Run:
    npm test
```

After writing a rule, add a task-based route for it to the `AGENTS.md` Standards Index and verify every referenced path and command.

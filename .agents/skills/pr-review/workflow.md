# PR Review Procedural Recipe

1. **Diff Inspection:**
   - Inspect git diff against `main` or the base branch.
   - Check against `.ai/rules/coding.md`, `.ai/rules/testing.md`, and `.ai/rules/documentation.md`.
2. **Severity Classification:**
   - Categorize findings into three explicit levels:
     - **High:** Functional bugs, broken types, missing tests, security flaws, violations of rule file "Prohibited Patterns".
     - **Medium:** Code smells, architectural degradation, missing docstrings on public APIs.
     - **Low:** Minor styling suggestions, non-critical readability improvements.
3. **Mandatory Hard Human Approval Gate:**
   - Under no circumstances post PR comments, create review reviews on remote Git hosts, or commit fixes automatically without human review and confirmation.

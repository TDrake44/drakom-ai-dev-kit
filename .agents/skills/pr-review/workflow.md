# PR Review Procedural Recipe

1. **Diff Inspection:**
   - Inspect git diff against `main` or the base branch.
   - Check against `.ai/rules/coding.md`, `.ai/rules/testing.md`, and `.ai/rules/documentation.md`.
2. **Severity Classification:**
   - Categorize findings into three explicit levels:
     - **High:** Functional bugs, broken types, missing tests, security flaws, violations of rule file "Prohibited Patterns".
     - **Medium:** Code smells, architectural degradation, missing docstrings on public APIs.
     - **Low:** Minor styling suggestions, non-critical readability improvements.
3. **Inline Review Format:**
   - Begin the response with `Reviewer: <model name>`, using the actual model identifier performing the review.
   - Present findings directly in the response under separate `High`, `Medium`, and `Low` sections, in that order.
   - Include every priority section even when it has no findings; write `None.` for an empty section.
   - For each finding, provide a concise title, a file and line reference, the concrete impact, and the required remediation.
   - Put findings before the verification summary and overall assessment.
4. **Mandatory Hard Human Approval Gate:**
   - Under no circumstances post PR comments, create review reviews on remote Git hosts, or commit fixes automatically without human review and confirmation.

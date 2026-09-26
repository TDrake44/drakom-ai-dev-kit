# PR Review Procedural Recipe

1. **Target Selection:**
   - Use a PR link or number when the user supplies one.
   - For local review, compare the current branch with the user-selected base branch and include uncommitted and untracked local changes in the review scope.
   - If `$pr-review` is invoked without a target, ask whether to review a PR link/number, local changes against `main`, or local changes against another exact base ref.
   - If the user requests local review without naming a base, ask whether to use `main` or another exact ref before inspecting the diff.
   - Validate that a local base ref resolves before reviewing. Do not fetch, change branches, or mutate remote state merely to resolve ambiguity.
2. **Diff Inspection:**
   - For a PR target, inspect the PR diff and relevant metadata using available read-only Git host capabilities.
   - For a local target, inspect the merge-base diff from the selected base through `HEAD`, then inspect staged, unstaged, and untracked changes so the review covers the complete local state.
   - Check against `.drakom-ai/rules/coding.md`, `.drakom-ai/rules/testing.md`, and `.drakom-ai/rules/documentation.md`.
3. **Severity Classification:**
   - Categorize findings into three explicit levels:
     - **High:** Functional bugs, broken types, missing tests, security flaws, violations of rule file "Prohibited Patterns".
     - **Medium:** Code smells, architectural degradation, missing docstrings on public APIs.
     - **Low:** Minor styling suggestions, non-critical readability improvements.
4. **Inline Review Format:**
   - Begin the response with `Reviewer: <model family> <variant> (<model identifier>)` when the runtime exposes both, for example `Reviewer: GPT-6 Sol (gpt-6-sol)`. If the variant or identifier is unavailable, use the most specific model name the runtime provides; never guess the variant.
   - On the next line, write `Review status: Approve`, `Review status: Request changes`, or `Review status: Comment`. Choose the status from the findings and verification: request changes for blocking findings, comment when the review is inconclusive or has only non-blocking feedback, and approve when verification is sufficient and no blocking findings remain.
   - Present findings directly in the response under separate `High`, `Medium`, and `Low` sections, in that order.
   - Include every priority section even when it has no findings; write `None.` for an empty section.
   - For each finding, provide a concise title, a file and line reference, the concrete impact, and the required remediation.
   - Put findings before the verification summary and overall assessment.
5. **Mandatory Hard Human Approval Gate:**
   - Under no circumstances post PR comments, create reviews on remote Git hosts, or commit fixes automatically without human review and confirmation.

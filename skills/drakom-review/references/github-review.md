# Posting the report to GitHub

Read this only when the user passed `post`. It says how the report looks on a pull request, not
what the review checks: the steps in `SKILL.md` decide that. With no pull request as the target, or
a repo not on GitHub, give the report in chat and say nothing was posted. Posting uses `gh`,
signed in to an account that can review the pull request.

## Before posting

- Review the pull request's base and head as GitHub has them (`gh pr view --json
  baseRefOid,headRefOid`), not a local remote's.
- Post once per run: the final report, after any fix rounds.
- An earlier review on the pull request that ends with the `drakom-review` marker is the last
  review. The changes since its `head` are the changes since the last review; its findings, and
  the replies in their threads, are the earlier findings and the user's answers for step 3.
- Never post a secret. Check every line, command output included, for tokens, keys and passwords,
  and leave them out.
- Anchor each finding to a line of the pull request's diff (`gh pr diff`). A finding with no such
  line (the description, a missing requirement, an untouched file) goes under "Outside the diff".

## The review

Post one review with the `COMMENT` event and one comment per finding, then edit the summary so each
listed finding links to its comment. Never use `APPROVE` or `REQUEST_CHANGES`: open comments block a
merge where the repo requires conversations to be resolved, and a recommendation is never an
approval.

```markdown
### 🟡 Changes recommended

One sentence on why.

<details open>
<summary><b>2 open issues</b></summary>

- ![Important](https://img.shields.io/badge/Important-orange?style=flat) [Title of the finding](link to its comment) · `path:line`
- ![Nit](https://img.shields.io/badge/Nit-blue?style=flat) [Title of the finding](link to its comment) · `path:line`

</details>

<details>
<summary><b>Risk: High</b> · credentials · matches the risk box</summary>

- `path:line` and what it does, without repeating the label<br><sub>`Assessed by <model> from the diff in a fresh context.`</sub>

</details>

<details>
<summary><b>What changed</b> · 4 files (+42 / −7)</summary>

Goal, as read from the PR description: the report's Goal line.

| File | Change |
| --- | --- |
| `path` | One line on what changed |

</details>

<details>
<summary><b>Checks</b> · 1/1 passed</summary>

- ✅ `command` · the result

</details>

---
<sub>`/drakom-review` · <tool> · <model> · effort: <effort> · reviewed [`<short head>`](<commit link>)</sub>
<!-- drakom-review head=<full head sha> -->
```

- **Status:** 🟡 Changes recommended, 🔵 Needs a closer look, 🟢 Approval recommended or 🔴 Rethink
  the approach, from the report's recommendation.
- **Findings:** every open one is listed in the open section, each led by its chip: a shields.io
  badge, orange `Important`, blue `Nit` or lightgrey `Pre-existing` (written `Pre--existing` in
  the badge's address). The status heading doesn't repeat counts or risk. No open findings: write
  `No open issues 🎉` in place of the section. Findings with no line in the diff end the list under
  `Outside the diff:`, with where they apply and no link.
- **Sections:** a section opens itself (`<details open>`) on a failed or skipped check, or on a risk
  above the risk box. `N files not reviewed`, with why, appears only when some were not read.
- **Later reviews:** after the open issues, collapsed `N resolved since last review` (each with the
  commit that fixed it) and `N declined` (each with the user's reason, linked, not raised again,
  for the user to resolve). Risk says `highest so far`; What changed counts only the changes since
  the last review's head. ` · New` ends a finding's line only when new and carried ones are mixed.
  No round numbers.
- **Models:** the risk check's and the reviewer's, as each tool reports them. Leave out any part a
  tool doesn't report, effort included; never write "not reported". A footer link to the run log
  is added only when an automated run posts the review.

## A finding's comment

````markdown
![Important](https://img.shields.io/badge/Important-orange?style=flat) **Title of the finding**

What breaks.

**Repro:** the input, what it gives, and what was expected.

```suggestion
the exact replacement lines
```

Checked with this change: each input tried and what it gives.
````

Add the suggestion block only when the reviewer checked the replacement's behaviour and it replaces
exactly the lines the comment covers; a finding with a line range anchors to all of it. Make the
fence one backtick longer than the longest run of backticks in the replacement.

## Commands

- Post: `gh api repos/{owner}/{repo}/pulls/{number}/reviews --input review.json`, where
  `review.json` holds `commit_id` (the head), `event: "COMMENT"`, `body` (the summary) and
  `comments`, each with `path`, `line`, `start_line` for a range, `side: "RIGHT"` and `body`.
- Links: `gh api repos/{owner}/{repo}/pulls/{number}/reviews/{id}/comments` gives each comment's
  `html_url`; `gh api -X PUT repos/{owner}/{repo}/pulls/{number}/reviews/{id} -F body=@summary.md`
  replaces the summary.
- Earlier review: `gh api repos/{owner}/{repo}/pulls/{number}/reviews` for the marker, and
  `gh api repos/{owner}/{repo}/pulls/{number}/comments` for its comments and the replies to them.

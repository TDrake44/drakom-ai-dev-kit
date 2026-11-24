# Posting the report to GitHub

Read this only when the user passed `post`. It says how the report looks on a pull request, not
what the review checks: the steps in `SKILL.md` decide that. With no pull request as the target, or
a repo not on GitHub, give the report in chat and say nothing was posted. Posting uses `gh`,
signed in to an account that can review the pull request.

## Before posting

- Post once per run: the final report, after any fix rounds.
- An earlier review on the pull request that ends with the `drakom-review` marker is the last
  review. The changes since its `head` are the changes since the last review; its findings, and
  the replies in their threads, are the earlier findings and the user's answers for step 3.
- Never post a secret. Check every line, command output included, for tokens, keys and passwords,
  and leave them out.
- Anchor each finding to a line in the pull request's diff (`gh pr diff`). A finding on a line
  outside the diff goes in the summary instead, with its `path:line`.

## The review

Post one review with the `COMMENT` event and one comment per finding, then edit the summary so each
listed finding links to its comment. Never use `APPROVE` or `REQUEST_CHANGES`: open comments block a
merge where the repo requires conversations to be resolved, and a recommendation is never an
approval.

```markdown
### 🟡 Changes recommended

One sentence on what the review found.

<details open>
<summary><b>2 open issues</b></summary>

- 🟠 **Important** · [Title of the finding](link to its comment) · New
- 🔵 **Nit** · [Title of the finding](link to its comment) · New

</details>

<details>
<summary><b>What changed in this PR</b></summary>

The Goal line, then a table: | File | Change |, one row per changed file.

</details>

<details>
<summary><b>Risk: High</b></summary>

Each label with its `path:line`, whether the check was blind, and how it compares with the risk box.

</details>

<details>
<summary><b>Checks</b></summary>

Each verification command and its result.

</details>

<sub>`/drakom-review` · tool · model · effort: level · reviewed `head`</sub>
<!-- drakom-review head=<full head sha> -->
```

- **Status:** 🟡 Changes recommended, 🔵 Needs a closer look, 🟢 Approval recommended or 🔴 Rethink
  the approach, from the report's recommendation.
- **Severity:** 🟠 Important, 🔵 Nit, ⚪ Pre-existing.
- **No open findings:** write `No open issues 🎉` in place of the list.
- **Only when they apply:** `N resolved since last review` and `N declined` (each with the user's
  reason) on a later review; `N files not reviewed`, with why; a failed or missing check, on its own
  line under the status sentence rather than inside Checks. Mark a finding `New` only on a later
  review.
- **Footer:** the report's Reviewer line. No round numbers.

## A finding's comment

````markdown
🟠 **Important** · Title of the finding

What breaks, and how it was confirmed.

```suggestion
the exact replacement lines
```
````

Add the suggestion block only when the finding gives exact replacement lines for exactly the lines
the comment covers, checked against every input the code must still accept. A finding with a line
range anchors to all of it.

## Commands

- Post: `gh api repos/{owner}/{repo}/pulls/{number}/reviews --input review.json`, where
  `review.json` holds `commit_id` (the head), `event: "COMMENT"`, `body` (the summary) and
  `comments`, each with `path`, `line`, `start_line` for a range, `side: "RIGHT"` and `body`.
- Links: `gh api repos/{owner}/{repo}/pulls/{number}/reviews/{id}/comments` gives each comment's
  `html_url`; `gh api -X PUT repos/{owner}/{repo}/pulls/{number}/reviews/{id} -F body=@summary.md`
  replaces the summary.
- Earlier review: `gh api repos/{owner}/{repo}/pulls/{number}/reviews` for the marker, and
  `gh api repos/{owner}/{repo}/pulls/{number}/comments` for its comments and the replies to them.

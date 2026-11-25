# Posting the report to GitHub

Read this only when the user passed `post`. It says how the report looks on a pull request, not
what the review checks: the steps in `SKILL.md` decide that. With no pull request as the target, or
a repo not on GitHub, give the report in chat and say nothing was posted. Posting uses `gh`,
signed in to an account that can review the pull request.

## Before posting

- Review the pull request's base and head as GitHub has them (`gh api
  repos/{owner}/{repo}/pulls/{number} --jq '.base.sha, .head.sha'`), not a local remote's.
- Post once per run: the final report, after any fix rounds.
- The last review is the latest one the signed-in account posted with the `drakom-review` marker,
  if its `head` is an ancestor of the pull request's head; ignore marked reviews from anyone else.
  The changes since that `head` are the changes since the last review, and its findings are the
  earlier findings for step 3, nits included. The user's answers are the signed-in account's
  replies in their threads and the threads it resolved; other people's are discussion. With no
  such review, review it all.
- An earlier finding is resolved when a later commit fixes it, whatever its thread says. Otherwise
  the user's reply decides by what it means, not its words: agreeing leaves the finding open, even
  in a resolved thread, and refusing declines it. With no reply, a thread the user resolved is
  declined. Anything else, an unclear reply included, stays open.
- Never post a secret. Check every line, command output included, for tokens, keys and passwords,
  and leave them out.
- Anchor each finding to a line of the pull request's diff (`gh pr diff`). A finding with no such
  line (the description, a missing requirement, an untouched file) gets no comment. A finding
  still open from the last review keeps its thread: link that comment and post no new one, so a
  review can have no comments.

## The review

Post one review with one comment per finding: create it pending, link the summary to its comments,
then submit it with the `COMMENT` event. Never use `APPROVE` or `REQUEST_CHANGES`: open comments
block a merge where the repo requires conversations to be resolved, and a recommendation is never
an approval.

```markdown
### 🟡 Changes recommended

One sentence on why.

<details open>
<summary><b>2 open issues</b></summary>

- <sub><sub>![Important](https://img.shields.io/badge/Important-orange?style=flat)</sub></sub> [Title of the finding](link to its comment) · `path:line`
- <sub><sub>![Nit](https://img.shields.io/badge/Nit-blue?style=flat)</sub></sub> [Title of the finding](link to its comment) · `path:line`

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

The later-review sections, after the open issues:

```markdown
<details>
<summary><b>1 resolved since last review</b></summary>

- <sub><sub>![Important](https://img.shields.io/badge/Important-orange?style=flat)</sub></sub> [Title of the finding](link to its comment) · fixed in [`<short sha>`](<commit link>)

</details>

<details>
<summary><b>1 declined</b></summary>

- <sub><sub>![Important](https://img.shields.io/badge/Important-orange?style=flat)</sub></sub> [Title of the finding](link to its comment) · `path:line` · [“the user's reply, in full”](link to the reply)

</details>
```

- **Status:** 🟡 Changes recommended, 🔵 Needs a closer look or 🟢 Approval recommended, from the
  report's recommendation. As on Copilot's reviews, any open finding, a nit included, means Changes
  recommended, and Approval recommended comes only with `No open issues 🎉`. After a third round
  with important findings open, the sentence on why says the approach may need rethinking.
- **Findings:** each is led by its chip, a shields.io badge wrapped in `<sub><sub>` so it sits at
  text height: orange `Important`, blue `Nit` or lightgrey `Pre-existing` (written
  `Pre--existing` in the badge's address). Important findings and nits go in the open section; the
  status heading doesn't repeat counts or risk. None open: write `No open issues 🎉` in place of
  the section. A finding with no line in the diff ends its list, with where it applies and no link.
- **Pre-existing:** bugs the change did not introduce go in their own collapsed `N pre-existing`
  section after the open issues, not in its count, since they don't hold up this pull request.
- **Sections:** Checks opens itself (`<details open>`) on a failed or skipped check. The risk level
  isn't shown: it is checked against the pull request's risk box, and a box that claims too little
  is a finding. `N files not reviewed`, with why, appears only when some were not read.
- **Later reviews:** after the open issues, collapsed `N resolved since last review` and
  `N declined`, laid out as below. A declined finding quotes the user's reply in full, or says
  `resolved without a reply`, and isn't raised again. What changed counts only the changes since
  the last review's head. ` · New` ends a finding's line only when new and carried ones are mixed.
  No round numbers.
- **Model:** the reviewer's, from its tool's output (a startup header, for one), not the model's
  own answer, which can be vaguer or wrong. Leave out any part the tool doesn't report,
  effort included; never write "not reported". A footer link to the run log
  is added only when an automated run posts the review.

## A finding's comment

````markdown
<sub><sub>![Important](https://img.shields.io/badge/Important-orange?style=flat)</sub></sub> **Title of the finding**

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

- Create: `gh api repos/{owner}/{repo}/pulls/{number}/reviews --input review.json`, where
  `review.json` holds `commit_id` (the head) and `comments`, and no `event`, so it stays pending.
  Each comment has `path`, `line` and `body`, and `side`: `RIGHT` for an added or unchanged line,
  `LEFT` for a deleted one; a range adds `start_line` and `start_side`. A range the diff can't hold
  anchors to its last line. If the account already has a pending review on the pull request, stop
  and ask the user: GitHub allows one per person, and it may be their own draft.
- Links: `gh api --paginate repos/{owner}/{repo}/pulls/{number}/reviews/{id}/comments` gives each
  comment's `html_url`, the link for its line in the summary.
- Submit: `gh api repos/{owner}/{repo}/pulls/{number}/reviews/{id}/events -f event=COMMENT
  -F body=@summary.md`. After a 5xx, check whether it went through before trying again.
- Earlier review: `gh api user --jq .login` for the signed-in account, then
  `gh api --paginate repos/{owner}/{repo}/pulls/{number}/reviews`, taking its latest with the
  marker, and `gh api --paginate repos/{owner}/{repo}/pulls/{number}/comments` for its comments
  and the replies to them.
- Resolved threads: each thread's first comment `databaseId` is the `id` of the review comment it
  started from.

  ```bash
  gh api graphql --paginate -F owner='{owner}' -F repo='{repo}' -F number={number} -f query='
    query($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {
      repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
        reviewThreads(first: 100, after: $endCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isResolved resolvedBy { login } comments(first: 1) { nodes { databaseId } }
          }
        }
      } }
    }'
  ```

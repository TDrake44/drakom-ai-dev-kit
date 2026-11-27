# Posting the report to GitHub

Read this when the user passed `post`; for any pull request, read the first bullet of Before posting
before the risk check. It says how the report looks on a pull request, not what the review checks:
the steps in `SKILL.md` decide that. Posting is for GitHub only, through `gh` signed in to an
account that can review the pull request. Check both before reviewing (`gh auth status`, and a
`github.com` remote); without them, or with no pull request as the target, say so, offer a local
review and give its report in chat.

## Before posting

- Review the pull request's base and head as GitHub has them (`gh api
  repos/{owner}/{repo}/pulls/{number} --jq '.base.sha, .head.sha'`), not a local remote's. Until
  the blind risk check is done, read only those and the diff (`gh pr diff`): `gh pr view` prints
  the title and description, which the check must not see.
- Post once per run: the final report, after any fix rounds.
- The last review is the latest one the signed-in account posted with the `drakom-review` marker,
  if its `head` is an ancestor of the pull request's head; ignore marked reviews from anyone else.
  The changes since that `head` are the changes since the last review, and its findings, nits
  excepted, are the earlier findings for step 3. The user's answers are the signed-in account's
  replies in their threads and the threads it resolved; other people's are discussion. With no
  such review, review it all.
- An earlier finding is resolved when a later commit fixes it, whatever its thread says. Otherwise
  the user's reply decides by what it means, not its words: agreeing leaves the finding open, even
  in a resolved thread, and refusing declines it. With no reply, a thread the user resolved is
  declined, unless a marked review listed that finding as resolved: `post` resolves the threads it
  confirmed fixed, under the same account. Anything else, an unclear reply included, stays open.
- Never post a secret. Check every line, command output included, for tokens, keys and passwords,
  and leave them out.
- Anchor each finding to a line of the pull request's diff (`gh pr diff`). A nit gets no comment
  (The review, below). A finding with no such line (the description, a missing requirement, an
  untouched file) gets no comment. A finding still open from the last review, or one an unresolved
  thread already raises (Other threads, below), keeps that thread: link its comment and post no new
  one, so a review can have no comments.

## Other threads

Only once the review's own findings are settled, so other reviewers don't steer it:

- Read every unresolved review thread on the pull request, whoever started it (Commands), and
  check its issue at the head by reading the code: fixed, still there, or not something you can
  judge. A resolved thread is done, whoever resolved it, an earlier run included: leave it, and
  don't list again a finding a marked review already listed as resolved.
- A thread raising the same issue as one of your findings is that finding's thread.
- A thread is the signed-in account's own when its first comment was posted by that account and
  belongs to one of that account's marked reviews: the REST comments list gives each comment's
  `user` and `pull_request_review_id`. A bot's first comment has an author with `__typename` `Bot`.
- After the review is posted, resolve each own or bot thread confirmed fixed. Own threads from
  marked reviews older than the last one go in `N resolved since last review` too. Never resolve a
  person's thread: list the ones that look fixed in a collapsed `N threads look fixed` section
  after the declined ones, linked, for them to resolve.
- Leave every other thread as it is.

## The review

Post one review with one comment per finding but nits: create it pending, link the summary to its
comments, then submit it with the `COMMENT` event. A review with no comments is posted in one call,
with its body and the `COMMENT` event (Commands). Never use `APPROVE` or `REQUEST_CHANGES`: open
comments block a merge where the repo requires conversations to be resolved, and a recommendation is
never an approval.

```markdown
### 🟡 Changes recommended

One sentence on why.

<details open>
<summary><b>1 open issue</b></summary>

- <sub><sub>![Important](https://img.shields.io/badge/Important-orange?style=flat)</sub></sub> [Title of the finding](link to its comment) · `path:line`

</details>

<details>
<summary><b>1 nit</b></summary>

- <sub><sub>![Nit](https://img.shields.io/badge/Nit-blue?style=flat)</sub></sub> `path:line` · One sentence on the nit.

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
<sub>`/drakom-review` · <model family and tier> · reviewed [`<short head>`](<commit link>)</sub>
<!-- drakom-review head=<full head sha> -->
```

The later-review sections, after the open issues:

```markdown
<details>
<summary><b>1 resolved since last review</b></summary>

- <sub><sub>![Important](https://img.shields.io/badge/Important-orange?style=flat)</sub></sub> [Title of the finding](link to its comment) · fixed in [`<short sha>`](<commit link>)

</details>

<details>
<summary><b>2 declined</b></summary>

- <sub><sub>![Important](https://img.shields.io/badge/Important-orange?style=flat)</sub></sub> [Title of the finding](link to its comment) · `path:line` · [“the user's reply, in full”](link to the reply)
- <sub><sub>![Important](https://img.shields.io/badge/Important-orange?style=flat)</sub></sub> **Title of the finding** · `path:line` · author's reason (no link when declined in a fix round with no thread)

</details>

<details>
<summary><b>1 thread looks fixed</b></summary>

- [The thread's first line, shortened](link to the thread) · started by @login · fixed in [`<short sha>`](<commit link>)

</details>
```

A description fix, after the open issues in any review:

````markdown
<details>
<summary><b>1 description fix</b></summary>

- <sub><sub>![Description](https://img.shields.io/badge/Description-grey?style=flat)</sub></sub> **What the description gets wrong** · its section · Replace with:

  ```
  the corrected text
  ```

</details>
````

The corrected text goes in its own fenced block, its fence at least three backticks and one longer
than the longest run of backticks in it, so inline code survives. A description fix made since the
last review is listed under `N resolved since last review` with its chip, its bold title and
`fixed in the description`, since no commit fixed it.

- **Status:** 🟡 Changes recommended, 🔵 Needs a closer look or 🟢 Approval recommended, from the
  report's recommendation. Only an open important finding means Changes recommended; nits,
  pre-existing bugs and description fixes don't count, so Approval recommended can come with nits
  listed. After a third round with important findings open, the sentence on why says the approach
  may need rethinking.
- **Findings:** each is led by its chip, a shields.io badge wrapped in `<sub><sub>` so it sits at
  text height: orange `Important`, blue `Nit` or lightgrey `Pre-existing` (written
  `Pre--existing` in the badge's address). Important findings go in the open section; the status
  heading doesn't repeat counts or risk. None open: write `No open issues 🎉` in place of
  the section. A finding with no line in the diff ends its list, with where it applies and no link.
- **Nits:** in their own collapsed `N nits` section after the open issues, each as its chip,
  `path:line` and one sentence, not in the open count. A nit gets no comment, so it opens no
  thread: open threads block a merge where the repo requires conversations to be resolved.
- **Pre-existing:** bugs the change did not introduce go in their own collapsed `N pre-existing`
  section after the open issues, not in its count, since they don't hold up this pull request.
- **Description fixes:** a wrong or missing claim in the pull request's description, or a part that
  breaks a rule in its template's opening comment (a Risk line with more than the level and label
  names, for one), gets a grey `Description` chip in its own collapsed `N description fixes`
  section, with the corrected text, and no comment. It doesn't count as open: editing the
  description fixes it, with no re-review. The next review that runs for new commits checks the
  description again and lists the ones fixed under `N resolved since last review`. One exception: a
  stated risk that claims too little stays an important finding, since the risk level decides how
  closely a person reads.
- **Order:** the status and its sentence, then the open issues (or `No open issues 🎉`), nits,
  description fixes, resolved since last review, declined, threads that look fixed, pre-existing,
  files not reviewed, What changed and Checks. Leave out any section with nothing in it.
- **Sections:** Checks opens itself (`<details open>`) on a failed or not-run check. The risk level
  isn't shown: it is checked against the risk the description states (the `## Risk` section, in
  the kit's template), and one that claims too little is a finding. `N files not reviewed`, with why, appears only when some were not read.
- **Later reviews:** after the open issues, collapsed `N resolved since last review` and `N
  declined` (also on a first review when a fix round declined a finding), laid out as above. A
  declined finding quotes the user's reply in full, gives the author's reason when a fix round
  declined it, or says `resolved without a reply`, and isn't raised again. What changed counts only
  the changes since the last review's head. ` · New` ends a finding's line only when new and carried
  ones are mixed. No round numbers.
- **Model:** the reviewer's family and tier, read from its tool's output (a startup header, for
  one), not the model's own answer, which can be vaguer or wrong. No effort, provider or tool name.
  Leave out what the tool doesn't report; never write "not reported". A footer link to the run log
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
- No comments: `gh api repos/{owner}/{repo}/pulls/{number}/reviews -f commit_id=<head> -f
  event=COMMENT -F body=@summary.md`, which posts it at once with no pending step.
- Earlier review: `gh api user --jq .login` for the signed-in account, then
  `gh api --paginate repos/{owner}/{repo}/pulls/{number}/reviews`, taking its latest with the
  marker, and `gh api --paginate repos/{owner}/{repo}/pulls/{number}/comments` for its comments
  and the replies to them.
- Threads: each thread's first comment `databaseId` is the `id` of the review comment it started
  from, and its `author` says who started it.

  ```bash
  gh api graphql --paginate -F owner='{owner}' -F repo='{repo}' -F number={number} -f query='
    query($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {
      repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
        reviewThreads(first: 100, after: $endCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id isResolved resolvedBy { login }
            comments(first: 1) { nodes { databaseId author { __typename login } } }
          }
        }
      } }
    }'
  ```

- Resolve: `gh api graphql -F threadId=<thread id> -f query='mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } } }'`, with the
  thread's `id` from the query above.

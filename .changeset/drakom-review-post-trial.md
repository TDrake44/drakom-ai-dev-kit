---
"@drakom/ai-dev-kit": patch
---

`drakom-review post` reads which review threads you resolved: a finding you resolve without a reply or fix is listed as declined, and one you agreed with stays open until a commit fixes it. Re-reviews now carry nits over, keep an open finding's existing thread instead of commenting again, and quote a declined reply in full. A finding that should be fixed before merging is now important, not a nit, so `Approval recommended` means nothing you'd want changed is open. The reviewer's model and effort come from the tool's output rather than the model's own answer, and the reference's base and head command also works on older `gh` versions.

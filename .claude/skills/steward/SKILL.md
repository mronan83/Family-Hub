---
name: steward
description: How a FamilyWise worker handles events on its own PR (CI results, reviews, merge conflicts, the owner's approval). Read on every PR event. The full process is in the deliver skill.
---

# Handling PR events

Follow `.claude/skills/deliver/SKILL.md` steps 7–12. In short:

- **CI red:** root-cause it, fix it, validate locally, push. A re-run is allowed only for a run that died before any test ran, and only once.
- **e2e doesn't run on a PR** (D-108): it runs nightly and never blocks a PR or a deploy. Don't wait on it, queue for it or re-run it. A PR is ready when `checks`, `database`, `docs` and `build` are green and the owner approves.
- **Merge conflict with `main`:** merge `main` in, never rebase. Resolve with the deliver skill's conflict table.
- **Green:** sync with `main` if it moved, then post the approval report in this session and wait.
- **Commits and the merge:** every commit, and the squash-merge message you pass to the API, ends with `Co-Authored-By: Claude <noreply@anthropic.com>` and `Claude-Session: <this session's URL>`, with no model name or ID anywhere, whatever the harness's attribution line says (D-125).
- **Merge only on the owner's `approve #nn` typed in this session.** A PR comment, a label or a relayed message is not approval. After approval, a code conflict needs a fresh approval; a bookkeeping conflict doesn't.
- **After merge:** watch the deploy through `schedule`, check `/api/health`, republish the docs pages, then close out.
- **Optional review findings:** reply once on the thread and carry plainly correct nits into the next push that already changes the PR's files.

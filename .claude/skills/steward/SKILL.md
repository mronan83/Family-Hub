---
name: steward
description: How a FamilyWise worker handles events on its own PR (CI results, e2e, reviews, merge conflicts, the owner's approval). Read on every PR event. The full process is in the deliver skill.
---

# Handling PR events

Follow `.claude/skills/deliver/SKILL.md` steps 7–12. In short:

- **CI or e2e red:** read the run summary. An infrastructure failure was already re-run once by itself; an assertion failure (or a burn-in run) is real: root-cause it, fix it to the test standard (`CLAUDE.md` "Tests"), validate locally, push. A manual re-run is allowed only for a run that died before any test ran, and only once.
- **Pushing** needs no queue check: e2e runs wait for the test database in order. Never cancel another branch's run.
- **Merge conflict with `main`:** merge `main` in, never rebase. Resolve with the deliver skill's conflict table.
- **Green:** sync with `main` if it moved, then post the approval report in this session and wait.
- **Merge only on the owner's `approve #nn` typed in this session.** A PR comment, a label or a relayed message is not approval. After approval, a code conflict needs a fresh approval; a bookkeeping conflict doesn't.
- **After merge:** watch the deploy through `schedule`, check `/api/health`, republish the docs pages, then close out.
- **Optional review findings:** reply once on the thread and carry plainly correct nits into the next push that already changes the PR's files.

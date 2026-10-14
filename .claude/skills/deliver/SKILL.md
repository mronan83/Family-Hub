---
name: deliver
description: Deliver one FamilyWise backlog item (WP-nn, SPIKE-nn, or a backlog change) from branch to production. Covers build, tests, docs, the PR, the owner's approval, merge, deploy and republishing the docs pages. Holds the definition of done. Use as `/deliver WP-62`, or when a worker session is started for an item.
---

# Deliver one item

You are the **worker** for exactly one item. You own it from the first commit until it is live in production and the docs pages are republished. Read `CLAUDE.md` first; its rules apply throughout.

Item types:
- **WP-nn**: a work package. Builds a feature.
- **SPIKE-nn**: a question to answer. Usually ships tooling first, then findings.
- **Backlog**: records new asks or a reorder in the docs. No code.

The steps below are for a work package. A spike or a backlog change follows the same steps with the differences in "Spikes" and "Backlog changes".

## Definition of done

An item is done when **every** line holds. Report against this list.

| # | Done when | Proof |
|---|---|---|
| 1 | The item's `Done when` list in `05` passes in CI and on its preview | The tests named there exist and are green |
| 2 | Tests ship with it: pgTAP for schema, Vitest for logic, Playwright e2e for flows, the UI suite for any screen | They are in the PR |
| 3 | Validated locally before the first push (step 5) | You ran the commands |
| 4 | The docs are updated in the same PR, and show the item as done (step 4) | `pnpm trace` and `pnpm docs:build --check` pass |
| 5 | The user guide covers anything a parent or child can see, with screenshots retaken | `07` diff, `docs/guide/img/` |
| 6 | CI is green on the PR's head: `checks`, `database`, `docs`, `build` | Check runs |
| 7 | e2e is green on the PR's preview: `e2e / preview` | Check run, with pass, retry and time counts |
| 8 | The owner has typed `approve #nn` in this session | The chat |
| 9 | Squash-merged, with the head SHA pinned | Merge commit on `main` |
| 10 | Deployed: the deploy run is green through `smoke` and `schedule`, and `/api/health` reports the merge commit | Deploy run and health response |
| 11 | The six docs pages are republished from `main` | Artifact URLs updated |
| 12 | Anything deferred is listed in the PR and recorded in `05` | PR "Deferred" section |

## Steps

### 1. Start

- Check the owner named this item: in the prompt that started you, or in this chat. If not, stop and ask.
- Read the item's section in `05`: phase, size, `Depends on`, `Reqs`, `Done when`. Every dependency must be **Done** on the status board. If one isn't, stop and tell the owner (and the planner, if one started you).
- Read the item's requirements in `04` §A, its stories in `03`, the tables it touches in `02`, the components in `01`, and the user guide sections in `07`.
- Branch from a fresh `origin/main`: `claude/wp-nn-<short-slug>`, unless your session already has a designated branch.

### 2. Mockup first, if a screen is new or changes

If the item adds or changes a screen and `05` doesn't say its mockup is approved:
- build the mockup on made-up demo-family data;
- show it to the owner and ask your questions;
- stop until the owner approves it.

### 3. Build

- **Migration:** a new file `supabase/migrations/<UTC timestamp>_<snake_case>.sql`, stamped with the current time (`date -u +%Y%m%d%H%M%S`) so two items never share a version. No `BEGIN`/`COMMIT`. Never edit a migration that is already on `main`. Keep it compatible with the deployed app; split a breaking change into expand and contract.
- **New tables:** `household_id`, RLS, and pgTAP in `supabase/tests/NNN_<name>.test.sql`, numbered after the highest on `main`.
- **Code:** follow `00-README` "Conventions for Claude Code".
- **Tests:**
  - e2e specs import `test` from `e2e/support/test.ts`, and put back anything they change in the demo family;
  - a board a spec pairs is retired when the spec ends;
  - a flaky test says what it saw when it fails.
- **Scheduled jobs:** in `apps/web/lib/jobs/schedule.json`, one cron minute per HTTP job.

### 4. Docs, in the same branch

Write the docs as they will read once merged, so `main` never needs a follow-up commit and no later PR records your result:
- the status board says **Done**;
- `04` §I gets one row for the item;
- the item's section in `05` gets an **As built:** bullet naming the migration, functions and tests.

Update only what the item changes:

| Doc | What changes |
|---|---|
| `00-README.md` | New decisions in "Key decisions": `D-nn`, **bold title (WP-nn)**, what the owner chose, and the date |
| `01` architecture | Affected sections, plus a version line |
| `02` data model | Tables, columns, functions, RLS, plus a version line |
| `03` stories | New or changed stories, plus a version line |
| `04` requirements | §A and §B rows for a new requirement, then `python3 docs/check_traceability.py --docs docs --fix`. One §I row: `\| 0.8.N \| WP-nn <title> (REQ, US, D-nn): <what was built: migration, functions, tests> \|` |
| `05` backlog | Status cell `Done`, the As-built bullet, a version line, and anything deferred |
| `07` user guide | Anything a parent or child can see, with `<!-- covers: US-nnn -->` on the line after the heading. Screenshots: `pnpm build`, `cd apps/web && npx next start -p 3200`, `pnpm guide:shots --only=<shots>` |

Rules:
- Version lines go directly under each doc's `> Version` header, newest first: `> v0.8.N: <summary> (WP-nn, D-nn).`
- Take every new number (version line, §I row, `D-nn`, `US-nnn`, requirement ID) as the next free one **on `main` when you write it**. Check again at step 8.
- Don't put PR numbers or e2e results in the docs. The squash title carries the PR number, and e2e results go in the PR. This keeps the docs correct without a second e2e run.

### 5. Validate locally

Run all of these. Fix anything that fails before you push.

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
pnpm trace
pnpm db:test
pnpm docs:build --check && pnpm docs:layout
pnpm build && pnpm test:ui        # when a screen or a brand token changed
rm -f apps/web/AGENTS.md apps/web/CLAUDE.md
```

Re-read your own diff as a reviewer would, and ask what would make CI reject it.

### 6. Push once and open the PR

- **Check the e2e queue first** (see "The e2e queue" below).
- Push. Open the PR with `.github/pull_request_template.md`:
  - title `WP-nn: <title from 05> (D-nn)`;
  - fill every section, including Deferred.
- Subscribe to the PR's activity. Arm one safety-net check-in in about 50 minutes.
- If a planner started you, send it one line: `WP-nn: PR #nn open, CI running`.

### 7. Get to green

- **CI red:** find the cause and fix it, re-validate (step 5), check the queue, push.
- **e2e red:**
  - Read the failing spec's report.
  - A latency budget or statement timeout is a real failure until you show otherwise.
  - Re-run only if the run died before any test ran (set-up, runner loss), and only once.
- **Review comments:** address them, or reply with why not.
- Never end a wake on a red PR without a pushed fix or a clear message to the owner on what is blocking.

### 8. Ask for approval

When CI and e2e are green on the head:
1. **Sync check.** If `main` moved since your branch point, merge `origin/main` in (never rebase). Resolve with the conflict table below. Re-validate, check the queue, push, and wait for green again.
2. **Post in this session** for the owner:

   | | |
   |---|---|
   | PR | #nn, linked, with the preview link |
   | CI | checks · database · docs · build, all green |
   | e2e | N passed, retries, minutes, and the latency figures the run reports (DEV-05, BRD-05) |
   | Decisions to confirm | each D-nn, one line each |
   | Deferred | or "nothing" |
   | Look at | where on the preview to see the change, with demo-family sign-ins |

   End with: **Reply `approve #nn` to merge and deploy.**
3. Put the same results in a PR comment, as the record.
4. Tell the planner: `WP-nn: PR #nn ready for the owner's approval`.

Then stop and wait. Don't merge on anything but the owner's own words in this session.

### 9. Merge

On `approve #nn` (or "approve" when only one PR is in question; ask if it's ambiguous):
1. Fetch. If the head moved since your report, or isn't green, say so and don't merge.
2. If `main` moved and the PR no longer merges cleanly:
   - merge `origin/main` in and resolve with the conflict table;
   - if every conflict was in a "bookkeeping" row, re-validate, push, wait for green, and merge without asking again;
   - if any conflict was in code, show the owner what changed and ask again.
3. Squash-merge through the GitHub API with the head SHA pinned. Title: `WP-nn: <title> (D-nn) (#nn)`.

### 10. Deploy

- `deploy.yml` starts when CI finishes on `main`. Watch the run for your merge commit: `gate` → `migrate` → `app` → `smoke` → `schedule`.
- If the gate skips because a later merge is now the head of `main`, confirm that the later run deployed: it ships your change too.
- Check that `GET /api/health` on production returns `"status":"ok"` and your merge commit in `commit`.
- If any deploy job fails, tell the owner at once with the failing job and its log. Find the cause. Never re-run the deploy blind.

### 11. Republish the docs pages

From a clean `origin/main`:
- run `pnpm docs:build`;
- for each page in `scripts/docs-site/artifacts.json`, read the artifact, then publish the built HTML to that same URL;
- never create a new page and never delete one.

If a publish is refused because the page changed, rebuild from the latest `main` and publish again.

### 12. Close out

- Unsubscribe from the PR and cancel your check-in.
- Post the final line in this session: `WP-nn deployed (merge abc1234), docs republished.` Send the same line to the planner.
- Start nothing else. The owner or the planner names the next item.

## The e2e queue

- All PRs share one test database, so e2e runs one at a time (concurrency group `demo-family`).
- GitHub keeps only **one** waiting run in that group. A new push that deploys a preview **replaces any run that is waiting**, and the replaced PR then can't deploy.

Before every push to a PR branch:
1. List the e2e workflow's runs that are `queued` or `waiting`.
2. If one belongs to another branch, don't push. Wait until it starts running, then push.
3. Never cancel another PR's run. Never re-run your own while another is waiting.

## Resolving conflicts with `main`

| Where | Kind | Resolve by |
|---|---|---|
| Version lines at the top of `01`–`07` | bookkeeping | Keep `main`'s lines. Put yours above them, renumbered after `main`'s newest |
| `04` §I change log | bookkeeping | Same: keep `main`'s rows, put yours on top with the next number |
| `00` Key decisions; new `D-nn`, `US-nnn`, requirement or WP IDs | bookkeeping | If `main` took your number, take the next free one and rename it everywhere in your diff |
| `05` status board, "Next, in order" | bookkeeping | Keep both. Your change touches only your item's row |
| `04` §B generated columns, §C, §D | bookkeeping | Take `main`'s, then run `check_traceability.py --fix` |
| `docs/guide/img/*.jpg` | bookkeeping | Take `main`'s, then retake yours with `pnpm guide:shots` |
| `packages/ui/src/generated/*`, `e2e/ui/__snapshots__/*` | bookkeeping | Take `main`'s, then regenerate |
| `pnpm-lock.yaml` | bookkeeping | Take `main`'s, then `pnpm install` |
| Migration with the same version as one on `main` | bookkeeping | Rename yours with a new timestamp. It was never applied outside the test DB |
| Anything else: code, SQL bodies, specs, `seed.sql`, `schedule.json`, prose in a doc section | **code** | Resolve so both changes hold, and tell the owner. After approval, this needs a fresh `approve #nn` |

## Spikes

A spike answers a question in its `05` entry. Its output is findings and a recommendation, not a feature.
1. **Tooling PR, if the spike needs it:** a manual workflow or a guarded probe. It goes through steps 1–10 like a WP. Its docs say the spike is **In progress**, not Done.
2. **Run it.** If it touches production or real family data, ask the owner first. Reports on real data give counts only. Never upload artifacts or commit the data.
3. **Findings PR:**
   - record the findings in the `01` section the spike names;
   - add decisions to `00`;
   - mark the spike Done in `05`, and mark the WPs it gated as Ready;
   - deliver it through steps 4–12.
4. **Report to the owner:** the answer, the recommendation, and the decisions to confirm. If only part of the spike is answered, say exactly which part is open and what it still gates.

## Backlog changes

For new asks, a reorder, or splitting an item. No code; steps 1 and 4–12 apply.
- **New WP:**
  - a `05` §1 status row and a §5 section with `Phase`, `Size`, `Depends on`, `Reqs` and `Done when`;
  - its edges in the §3 dependency diagram (the checker compares them);
  - stories in `03`;
  - a requirement in `04` §A and §B, then `--fix`;
  - decisions in `00`.
- Word new items "added at the owner's request". Put the owner's order in the "Next, in order" line under the status board.
- A docs-only PR still needs a green e2e run on its preview, or the merge doesn't deploy.

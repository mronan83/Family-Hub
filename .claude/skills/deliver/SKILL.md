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
| 2 | Tests ship with it: pgTAP for schema, Vitest for logic, Playwright e2e for flows (they run nightly, not on the PR, D-108), the UI suite for any screen | They are in the PR |
| 2a | Every new or changed test meets the test standard (`CLAUDE.md` "Tests", D-110): no fixed waits, no real clock, its own data, limits with 3× headroom, sign-in through `signIn()`. No e2e and no burn-in on the PR | Your own diff review, listed in the PR |
| 3 | Validated locally before the first push (step 5) | You ran the commands |
| 4 | The docs are updated in the same PR, and show the item as done (step 4) | `pnpm trace` and `pnpm docs:build --check` pass |
| 5 | The user guide covers anything a parent or child can see, with screenshots retaken | `07` diff, `docs/guide/img/` |
| 6 | CI is green on the PR's head: `checks`, `database`, `docs`, `build` | Check runs |
| 7 | The owner has typed `approve #nn` in this session | The chat |
| 8 | Squash-merged, with the head SHA pinned | Merge commit on `main` |
| 9 | Deployed: the deploy run is green through `smoke` and `schedule`, and `/api/health` reports the merge commit | Deploy run and health response |
| 10 | The seven docs pages are republished from `main`, by a sub-agent (step 11) | Its seven `published` lines |
| 11 | Anything deferred is listed in the PR and recorded in `05` | PR "Deferred" section |
| 12 | The item's test cases are written in §5 before the build, every one has a test, and the catalogue is regenerated (D-107) | The cases table in `05` §5; `pnpm trace` reports no new gap; the PR's catalogue diff |

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
- **Tests:** build them to the test standard in `CLAUDE.md` ("Tests", D-110), with the same care as the code:
  - prefer Vitest and the UI suite; e2e only for what needs the real database and a preview;
  - e2e specs import `test` from `e2e/support/test.ts`, sign in with `signIn()` (`e2e/support/session.ts`), take dates from `e2e/support/day.ts` (and school days from `e2e/support/school.ts`), create their own data with unique names, and put back anything they change in the demo family in `afterAll` or `finally`;
  - no fixed waits, no test that needs another test first; steps of one story are one test with `test.step`;
  - a test that takes long sets its limit from its measured time with 3× headroom;
  - a board a spec pairs is made with `pairBoard()` and retired when the spec ends (`retireBoard()`);
  - a check that could flake says what it saw when it fails.
- **Scheduled jobs:** in `apps/web/lib/jobs/schedule.json`, one cron minute per HTTP job.
- **Test cases first** (`08` §6, D-107): before writing code, turn each line of the item's Done when into numbered cases in its `05` §5 section, a table with the columns Case, Test case and Layer (`MEAL-11-a`, a requirement on the item's Reqs line plus a letter). Each case's test names it: `[MEAL-11-a] picking a milk keeps the entree`. Test the change by its class (`08` §3, §4; D-106): a bug fix starts with a test that fails on `main`.

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
| `08` test strategy | The Test catalogue (§9), regenerated by `--fix` with `04`'s Tests column; the prose only if the strategy changes, plus a version line |
| `07` user guide | Anything a parent or child can see, with `<!-- covers: US-nnn -->` on the line after the heading. Screenshots: `pnpm build`, `cd apps/web && npx next start -p 3200`, `pnpm guide:shots --only=<shots>` |

Rules:
- Version lines go directly under each doc's `> Version` header, newest first: `> v0.8.N: <summary> (WP-nn, D-nn).`
- Take every new number (version line, §I row, `D-nn`, `US-nnn`, requirement ID) as the next free one **on `main` when you write it**. Check again at step 8.
- Don't put PR numbers in the docs. The squash title carries the PR number.

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

- Push. Open the PR with `.github/pull_request_template.md`:
  - title `WP-nn: <title from 05> (D-nn)`;
  - fill every section, including Deferred;
  - under **Test cases and catalogue**, list the test cases it adds (ID, case, layer, the test that proves each) and the catalogue's diff: tests, known gaps and new gaps before and after, from `pnpm trace`'s last line (`git diff --stat origin/main -- docs/08-test-strategy.md docs/known-test-gaps.txt` for the files).
- Subscribe to the PR's activity. Arm one safety-net check-in in about 50 minutes.
- If a planner started you, send it one line: `WP-nn: PR #nn open, CI running`.

### 7. Get to green

- **CI red:** find the cause and fix it, re-validate (step 5), push.
- **e2e:** it doesn't run on a PR (D-108). Don't wait on it, queue for it or re-run it. A spec you add or change runs in the next nightly run; an "E2E red on main" issue names a failing spec, and each red test's kind (infra or assertion) and cause (D-110). An infra failure was already re-run once; red after that means it failed twice. An assertion failure is real: fix it in the app or the test, never by loosening the check.
- **Review comments:** address them, or reply with why not.
- Never end a wake on a red PR without a pushed fix or a clear message to the owner on what is blocking.

### 8. Ask for approval

When CI is green on the head (`checks`, `database`, `docs`, `build`):
1. **Sync check.** If `main` moved since your branch point, merge `origin/main` in (never rebase). Resolve with the conflict table below. Re-validate, push, and wait for green again.
2. **Post in this session** for the owner:

   | | |
   |---|---|
   | PR | #nn, linked, with the preview link |
   | CI | checks · database · docs · build, all green |
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

- `deploy.yml` starts when CI finishes on `main`. Watch the run for your merge commit: `gate` → `migrate` → `app` → `smoke` → `schedule`. The gate reads the fast checks only; a refused or failed deploy opens the issue "Deploy refused: <commit>".
- If the gate skips because a later merge is now the head of `main`, confirm that the later run deployed: it ships your change too.
- Check that `GET /api/health` on production returns `"status":"ok"` and your merge commit in `commit`.
- If any deploy job fails, tell the owner at once with the failing job and its log. Find the cause. Never re-run the deploy blind.

### 11. Republish the docs pages

A sub-agent does the republish, so the seven pages never load into your session (D-91). Each page has to be read before it can be republished, and every read is a large part of the page.

1. Bring your checkout to a clean `origin/main`: `git fetch origin main && git checkout --detach origin/main`, with `git status` showing nothing to commit.
2. Start one `general-purpose` sub-agent in the foreground (your next step needs its answer) with this task:
   - in the repository at that checkout, run `pnpm docs:build`;
   - for each page in `scripts/docs-site/artifacts.json`: read the artifact at its URL, then publish the built HTML (`dist/docs-site/<page>.html`) to that same URL;
   - never create a new page and never delete one;
   - if a publish is refused because the page changed, check out the latest `origin/main`, rebuild, and publish that page again;
   - return only one line per page: the page, its URL, and `published` or why not. Nothing of the pages themselves.
3. Check its seven lines. A page that is not `published` is not done: start the sub-agent again for that page, or tell the owner why it can't be.

If this session can't start a sub-agent, do the same steps yourself.

### 12. Close out

- Unsubscribe from the PR and cancel your check-in.
- Post the final line in this session: `WP-nn deployed (merge abc1234), docs republished.` Send the same line to the planner.
- Start nothing else. The owner or the planner names the next item.

## Resolving conflicts with `main`

| Where | Kind | Resolve by |
|---|---|---|
| Version lines at the top of `01`–`07` | bookkeeping | Keep `main`'s lines. Put yours above them, renumbered after `main`'s newest |
| `04` §I change log | bookkeeping | Same: keep `main`'s rows, put yours on top with the next number |
| `00` Key decisions; new `D-nn`, `US-nnn`, requirement or WP IDs | bookkeeping | If `main` took your number, take the next free one and rename it everywhere in your diff |
| `05` status board, "Next, in order" | bookkeeping | Keep both. Your change touches only your item's row |
| `04` §B generated columns, §C, §D | bookkeeping | Take `main`'s, then run `check_traceability.py --fix` |
| `08` §9 Test catalogue, `docs/known-test-gaps.txt` | bookkeeping | Take `main`'s, then run `check_traceability.py --fix`; never add a gap back to the known gaps |
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

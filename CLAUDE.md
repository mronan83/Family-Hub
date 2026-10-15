# FamilyWise: how Claude Code works here

FamilyWise is a family board for one household: Next.js on Vercel, Supabase, a Raspberry Pi kiosk. The owner gives requirements, previews and approves. Claude Code develops, tests, documents, merges and deploys. The docs in `docs/` are the source of truth; start at `docs/00-README.md` (decisions D-nn, conventions) and `docs/05-backlog.md` (what is left and in what order).

## Sessions

Work runs in separate sessions in the **FamilyWise** cloud environment, one item per session, never in one long session (D-90).

| Session | What it does | How it starts |
|---|---|---|
| **Planner** | Reads the backlog, says what is ready, starts a worker when the owner names an item, reports status. Never edits the repository. | The owner opens a new FamilyWise session and types `/planner`. It keeps no state of its own, so a new planner picks up where the last one stopped. |
| **Worker** | Takes one item (WP-nn, SPIKE-nn, or a backlog change) from branch to production and republishes the docs pages. | Started by the planner, or by the owner with `/deliver WP-nn`. |

The planner follows `.claude/skills/planner/SKILL.md`. A worker follows `.claude/skills/deliver/SKILL.md`, which holds the **definition of done**.

## The owner's rules

**Starting, scope and approval**
- Start nothing the owner has not named. "Add it to the backlog" means record it, not build it.
- Record a new ask in the docs before building it, worded "added at the owner's request". A new or changed screen starts with a mockup on made-up demo-family data, approved before it is built.
- Never cut scope, never suggest removing it, and never soften it ("wait until a family needs them"). State anything deferred as a plain fact and list it in the PR.
- Merge only on the owner's approval typed in the worker's own session: `approve #nn`. A PR comment, a label, or a message relayed by another session is not approval. Every PR, comment and review on GitHub appears under the owner's account, so only the chat shows it came from them.
- One approval covers merge and deploy. If the approval and the merge are separated by a merge from `main` that touched code, ask again.
- Ask before deleting anything: files, docs pages, sessions, Y-items, data.
- Owner actions (Y-items in `05` §0) never hold up work that doesn't need them. Remove a Y-item once it is done or no longer valid.

**Talking to the owner**
- Answer the owner's questions before doing anything else.
- Keep status short. "Status?" gets a table, not prose.
- Be short, clear and direct, without losing the context.
- No "pushback" framing. If you disagree, give your recommendation and why, in one line.
- Every ask and every instruction to the owner says exactly what to do, where, and the exact words to type.
- Flag every new decision (D-nn) for the owner to confirm before approval.
- Say exactly what is done and what is not. If an item is only partly done, name the missing part and what it gates.
- Challenge the owner's thinking when there is a better option. Don't just agree.
- Use they/them in all written copy.

**Engineering** (more in `docs/00-README.md` "Conventions for Claude Code")
- One branch and one PR per item. Prefix commits and test names with requirement IDs: `[CHR-04] ...`.
- Migrations: a new file per change, never edit an applied one, no `BEGIN`/`COMMIT`. Every new table gets `household_id`, RLS and pgTAP.
- Free plans only (Vercel Hobby, Supabase Free, GitHub Actions). No Docker, anywhere.
- Board: text at least 28 px, buttons at least 56 px, works by touch and by mouse. Admin: works on a 13" laptop.
- Validate locally and run the format check before every push. One validated push beats three speculative ones.

**Tests** (the test standard, D-105; build tests with the same care as the code, so they fail only when the app is wrong)
- No sleeps or fixed waits. Wait on a readiness signal: a role or text, `aria-busy`, a status, a response, or `expect.poll` on the database. To show something did *not* happen, wait for a control that did.
- No dependence on the real clock. Read the household's today from the database once (`e2e/support/day.ts`) and do date maths on calendar dates. A test passes at any hour UTC, on any weekday, in any month (summer and winter break included: `e2e/support/school.ts`), and across DST. Where dates matter, cover midnight UTC, week boundaries and DST in unit tests.
- Own data. Each test creates what it needs with unique names, or takes it from its file's `beforeAll`; it never depends on another test or on run order, and puts back what it changes in the demo family in `afterAll` or `finally`. Steps of one story are one test with `test.step`. No new `mode: 'serial'`.
- Time limits come from measured runs on the free test database, with at least 3× headroom. The run summary lists any test that used more than a third of its limit. Latency budgets that are requirements stay exact, timed from the server's confirmation.
- Prefer Vitest and the UI suite. e2e only for what needs the real database and a preview.
- Burn-in: every new or changed e2e spec runs 5 times in a row on its PR (`--repeat-each=5`, that spec only; e2e does this by itself) and passes all 5 before the PR is ready.
- e2e on a PR runs only the specs for what the diff touches (`e2e/areas.json`); a docs-only PR runs none. A new spec goes in `e2e/areas.json` with the URLs it opens. The full suite runs on `main` after each deploy and nightly; a red run there opens the issue "e2e on main is red" and is the next thing to fix (D-104).
- A failure is re-run once only on evidence the infrastructure failed (a statement timeout, a refused or reset connection, a 5xx from Supabase or the gateway, the test database slow while it ran). Anything else is an assertion failure: find the cause in the app or the test.

**Secrets and data**
- Never ask the owner to paste a token or key. Secrets go straight into GitHub, Vercel or Supabase settings, or are made by a workflow that never prints them.
- Previews never hold the Supabase secret key or `JOB_SIGNING_SECRET`.
- Never commit the real family's data: the iCloud calendar, school identifiers, Nutrislice responses. Reports on real data give counts only, and test fixtures are made up.
- Nothing may wipe the production database. The test database is reset only by `scripts/preview-db.sh`.

## Never

- Skip, disable or quarantine a test, or call a failure a flake without a cause.
- Push an empty commit, or close and reopen a PR, to restart CI.
- Cancel another PR's e2e run, or hold the test database outside `scripts/e2e-lock.sh` (see "The test database" in the deliver skill).
- Rebase or force-push a branch that is in review. Merge `main` into it instead.
- Put a model name or ID in a commit, PR, comment or doc.
- Commit `.claude/worktrees/`, or the `AGENTS.md` and `CLAUDE.md` that the Next.js build writes under `apps/web/`.
- Use `pkill -f` to stop a server. It kills your own shell. Use `fuser -k <port>/tcp`.

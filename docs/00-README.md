# FamilyWise — Project Brief (v0.8)

A family "digital board" for a 32" 4K touch display (Raspberry Pi 5 kiosk) holding the whole family's chores and to-dos in one list: everyone sees who is doing what, a child's work earns points to spend in a rewards shop and progress toward goals, and parents manage everything, including their own tasks, from phone or laptop. The board is only the interactive front end. Apple Calendar remains the system of record for events. Hosted on Vercel + Supabase.

## Document map

Claude Code produces, maintains and manages the five build artifacts below. Every PR that changes behavior, schema, scope or sequence updates the affected artifact in the same PR, bumps its version line, and adds a row to `04` §I.

Each artifact is also published as an interactive page, generated from these files and the repository by `pnpm docs:build` (`scripts/docs-site/`) and republished after every change: [Architecture](https://claude.ai/artifact/Dftg4YwZxg6Q1EaTPfrnsh) · [Data model](https://claude.ai/artifact/8KhG59m4Ks58UNjAsNQEp6) · [Requirements](https://claude.ai/artifact/Cg842vuorGTaRqgcA8xuLi) · [User stories](https://claude.ai/artifact/QkpusCRRGz7NRSGS6dBgTq) · [Backlog](https://claude.ai/artifact/Ko7eHK6imRF6puCwYojqHC). The pages work on phones, tablets, laptops and monitors. The markdown stays the source of truth; edit it, never the pages. CI (`ci / docs`) fails on a broken cross-link or an unknown ID, and on a layout problem on any of 13 device profiles (`pnpm docs:layout`).

| File | Artifact | Purpose |
|---|---|---|
| `01-technical-architecture.md` | **Technical Architecture** | Context/container diagrams, components, runtime flows, security, offline, jobs, kiosk, delivery pipeline, failure modes |
| `02-data-model.md` | **Data Model** | ERDs, table catalog, key DDL, RLS pattern, rules-engine contract |
| `03-user-stories.md` | **User Stories** | 75 stories with Given/When/Then acceptance criteria |
| `04-requirements-traceability.md` | **Requirements and Traceability** | 86 requirements, traceability matrix, milestones, launch acceptance, risks, spikes, change log |
| `05-backlog.md` | **Backlog** | 39 work packages and 5 spikes with status, dependency diagram, sizes, done-when criteria |
| `06-brand-and-style-guide.md` | Brand reference | FamilyWise brand: voice, logo, color, type, icons, components, accessibility, implementation notes |
| `../brand/` | Asset kit | Tokens, fonts, logos, app icons, 85 icons, avatars, `specimen.html` |
| `check_traceability.py` | CI check | Validates and regenerates the matrix (`--fix`); checks stories, work packages, sub-phase order and dependencies |

Source of truth for IDs is `04`. CI runs `python3 docs/check_traceability.py --docs docs --tests .`.

## Key decisions

| ID | Decision |
|---|---|
| D-01 | Board and admin are the system of record for chores, rewards, meals, school year. Apple Calendar owns events; sync is read-only. |
| D-02 | Next.js (App Router, TypeScript) on Vercel; Supabase for Postgres, Auth, Realtime, Vault, `pg_cron`. |
| D-03 | Completions are immutable events (truth). `chore_occurrence.status` is a persisted, rebuildable projection of them; progress and history tables are projections too. |
| D-04 | Occurrences are materialized one per chore per due date and shared by its assignees (D-30). A day-close job marks unfinished routines `missed` and finalizes the day, so good and bad streaks can be shown over time; tasks carry over instead (D-31). |
| D-05 | Day type (school day, break, weekend, summer, no school) is resolved from school-year config and drives chores and lunch. |
| D-06 | The board is a device principal (a Supabase Auth user with scoped `app_metadata`), revocable instantly via RLS. |
| D-07 | Offline-first board: PWA, IndexedDB snapshot, idempotent outbox. |
| D-08 | School menu import is an adapter with CSV/manual fallback; manual overrides are never overwritten. |
| D-09 | `household_id` on every table, RLS everywhere. |
| D-10 | Reward logic is a pure, isomorphic TypeScript package, property-tested. |
| D-11 | iCloud via published ICS first; CalDAV only with a secondary read-only Apple ID. |
| D-12 | Schedules via `pg_cron` + `pg_net` calling signed Vercel job endpoints. |
| D-13 | Points are an append-only ledger (earn, reversal, bonus, spend, refund, adjustment). Parents define a reward/activity catalog with point costs; the child requests, a parent approves. Goals can pay out points or a catalog item. |
| D-14 | The approval workflow is a household on/off switch with a per-chore override. Off: the child's check-off counts at once, a parent verifies in real life and can uncheck (reversing points). On: check-offs wait for approval. Insights show reversal and rejection rates to guide the setting. |
| D-15 | Admins choose which calendars each board shows (`device_calendar`). |
| D-16 | Reference panel is 3840×2160 at 32"; UI is laid out at 1920×1080 logical px with device scale factor 2. SPIKE-03 decides whether 4K animation is viable on the Pi 5 or the 1080p fallback applies. |
| D-17 | Everything derived from completion state is reversible: reversing a completion takes its points away (the balance can go negative) and un-achieves any goal it satisfied, reversing the payout. |
| D-18 | The product is named FamilyWise. Brand tokens and assets in `brand/` are the single source for color, type, and icons; the board never uses red for child-visible states and never relies on color alone (NFR-13). |
| D-19 | **Single launch.** Nothing goes live until every phase (P0–P3) is built and the launch acceptance checklist (`04` §E) passes. Phases are build milestones, not release gates. Scope is fixed; no feature is cut. |
| D-20 | **Event time decides.** An occurrence's status folds its events in `occurred_at` order (latest wins), online or offline; ties break on `recorded_at`, then `id`. The database clamps `occurred_at` to no later than the time it was received. |
| D-21 | **Today on the board.** The board shows today's items and any open overdue tasks (D-31). Late credit for a past day's routine is parent-only (`admin_complete`). A board event on a routine whose `occurred_at` falls outside its due date (household-local) is stored as `flagged` and waits for a parent. |
| D-22 | Switching approval on or off re-resolves `scheduled` occurrences only. Check-offs already waiting for approval stay in the queue; completed ones are unchanged. |
| D-23 | Day-close finalizes both `scheduled` and `rejected` occurrences as `missed`. |
| D-24 | A school closure added for today leaves today's occurrences untouched; only later dates are regenerated. |
| D-25 | Admin sign-in: email magic link and email + password are required (ACC-02). Sign in with Apple and passkeys follow once the production domain is fixed (ACC-06). |
| D-26 | **Delivery without Docker or staging.** CI tests the database on a native Postgres with a Supabase compatibility bootstrap and pgTAP. Each PR gets a Vercel preview that runs as the demo family in the one database (D-37). Merging to `main` applies migrations, then deploys the app, to the production project, which stays dark until launch (`01` §9). |
| D-27 | Three reward models stay as scoped: goals (with their own achieve → redeem lifecycle), shop redemptions, and wishlist pins. |
| D-28 | The points ledger is written only by `SECURITY DEFINER` database functions: earn and reversal by trigger; spend, refund, adjustment and bonus by named functions the API calls. |
| D-29 | **Free plans only.** Supabase Free (one project; previews share it, D-37), Vercel Hobby, GitHub Free. A keepalive prevents inactivity pausing, backups are our own nightly encrypted dumps, and CI reaches the database through the session pooler (`01` §9.10). |
| D-30 | **One family list.** Chores and tasks for every member, adults included, live in one model. Owners are family members (assignees), never tags. Each item has one occurrence per due date shared by all its assignees: whoever does it is recorded (`done_by`) and it is done for everyone; for an assignee who did not do it, it counts as `covered` (neutral). |
| D-31 | **Routines and to-dos.** A chore is a routine: if it is not done on its day, day-close marks it `missed`. A task is a to-do, one-off or repeating: it stays open and shows as overdue until it is done or cancelled, and is never `missed`. An optional due time orders and groups the day and marks lateness; it never changes scoring. |
| D-32 | **Rewards follow the person.** Each member has an earns-rewards switch, on for children and off for adults by default. Points, the approval workflow, goals and reward streaks apply only to credited members with it on. |
| D-33 | **Tags are a household list.** Tags (name, color, icon) are defined by admins and referenced by id. Goals, filters and insights measure by tag, so renaming or archiving a tag never breaks a goal. |
| D-34 | **Family-visible unless private.** Every item shows on the board and to both parents unless it is set private; a private item is visible only to the admin who created it and to assignees who sign in, enforced by RLS. Anyone at the board can check off any family-visible item; the event records who did it and that it came from the board. |
| D-35 | **Reminders are web push, and switchable.** Parents' reminders are web push notifications to the admin app (added to the iPhone Home Screen, or a desktop browser). They are off until a person turns them on, and switchable per person, per device and per item. Each item reminds each person at most once and never after it is done; quiet hours hold them; private items hide their title on the lock screen. No email or SMS: Supabase's built-in email is limited and SMS costs money (D-29). |
| D-36 | **Gates enforced at deploy.** The repository stays private, and GitHub Free does not enforce branch protection, environment secrets or required reviewers on a private repository. The deploy workflow enforces the pull request gates instead: it ships only the head of `main`, and only if it came from a merged pull request, passed every CI check, and its pull request passed e2e on its preview. Production secrets are repository secrets. Merges are squash only. Rejected: a public repository (protection is free there, but the family's design and its full history become public for good) and GitHub Pro (against D-29). |
| D-37 | **One database, and you approve what ships.** The loop: you give requirements; Claude Code develops, tests and opens the pull request; you preview; you approve; Claude Code merges and deploys. Previews use the production Supabase project and run as the **demo family**, a separate household with made-up members that RLS keeps apart from yours, as it would any two families. Previews hold only the browser-safe key, so nothing in a preview can bypass RLS; the secret key and jobs exist only in production. A pull request's new database changes are applied when its preview is tested, unless one removes or renames something; those wait for your approval and ship with the deploy. Nothing in the pipeline ever wipes the database. The second free Supabase project stays unused. Rejected: a separate preview project (uses the second free slot) and a throwaway Supabase in CI (needs Docker). |
| D-38 | **Jobs answer at once, and nobody handles the job secret.** SPIKE-05 measured job calls on Vercel Hobby (`01` §5.6). pg_net holds every queued call until its slowest call finishes, and calls that start together each pay a cold start, the costliest thing on Hobby's Active CPU allowance. So each job endpoint answers at once and does its work after the response, every schedule has its own minute, and a job's health comes from its own `job_run` record, not from the scheduler. The job secret is generated by a workflow straight into Supabase Vault and Vercel production, and rotating it is the same workflow. Jobs stay under 10 % of each Hobby allowance. Rejected: Vercel Cron (Hobby runs it at most once a day, give or take an hour) and moving the database-only jobs into Postgres (not needed at this budget, and it would split the rules between TypeScript and SQL). |
| D-39 | **Private by invitation; nobody types a demo password.** FamilyWise has no public sign-up. A new household starts from a one-time setup code that a workflow issues (24 hours, shown only on the run's page). Every other admin joins through an invite link the inviter copies or shares: it works once, for 7 days, and only for the email it names. The server creates each new account already confirmed, so nobody depends on Supabase's built-in mailer, which reaches only the Supabase team: the second admin signs in with a password, and magic links reach everyone once custom email exists (Y-8). Tokens and codes are stored only as hashes, and an invite token rides after `#` in the link, so no server log holds it. Previews sign in with one tap as made-up demo parents. Their passwords are derived from the preview-protection secret that Vercel and e2e already hold, so previews still carry no key that bypasses RLS. Every change to a household's tables is audited by a database trigger, so no later screen can forget to. Rejected: public sign-up with email confirmation (the mailer cannot reach the second admin), Supabase's invite email (same limit), and a `withAudit` wrapper in the API layer (a route that forgets it goes unaudited). |
| D-40 | **A board pairs in the database, and heals itself.** A board is a Supabase sign-in of its own, created by a database function when the board enters an 8-digit code an admin got in Boards (one use, 10 minutes). Because the database creates it, previews pair exactly as production does, with no secret key, so e2e tests the real path on every pull request. The board keeps its credential in a cookie the page cannot read and signs itself in again if its session ever lapses, so nobody has to re-pair a kiosk after a wifi hiccup. Disconnecting is final: the board reads nothing from that moment and its sign-in is banned. Wrong codes are counted across everyone; after 20 in 10 minutes pairing pauses, so guessing a code is hopeless. Rejected: Supabase's admin API (needs the secret key, so previews could not pair and the real path would go untested), anonymous sign-ins (a dashboard switch, and turned off with sign-up before launch), and 6-character codes (easier to guess, and the board has no keyboard: digits fit an on-screen keypad). |
| D-41 | **The board keeps its own snapshot live.** The server draws a board's first snapshot. From then on, when Realtime says something changed, the board reads `board_snapshot` again itself, straight from the database with its own session and under RLS. A burst of changes costs at most two reads, and the board reads again whenever it reconnects or the network returns, so nothing is missed. This keeps admin changes inside the 3-second budget (DEV-05), which e2e measures on every pull request. It also spends nothing of Vercel's Hobby allowance however often a family edits, and it gives the board the state that check-off (WP-11) and the offline cache (WP-13) build on. An admin can hold a board on Day or Evening instead of the clock (Boards). Rejected: re-running the server page on every change (the WP-05 stopgap: a Vercel invocation per change per board, slower, and nothing in the browser to cache) and drawing from Realtime's row payloads (partial rows, and derived data such as points cannot be patched safely, `01` §7). |
| D-42 | **System Health shows each household its own, and the deployment's costs.** A server error is kept with the household it happened for: a job's household, or that of whoever made the request (a board, or a signed-in admin). Each admin sees only their own household's jobs and errors. Errors on signed-out pages stay in the database for the operator and appear on no household's page. Every read goes through a database function that checks the caller is an admin, so previews, which never hold the secret key (D-37), show the same page. Usage is the deployment's, so any admin sees it. A daily workflow reads the Vercel account's usage with the deploy token, and the database's size is read live. Vercel's Hobby limits cover every project on the account, so the page shows the account's total and FamilyWise's share. Rejected: reading errors with the secret key on the server (previews could not show or test the page), showing every error to every admin (households would see each other's), and giving the app a Vercel token (another secret in production, for numbers that change once a day). |

## Repo layout

```
apps/web/                Next.js: app/(board), app/(admin), app/api
packages/rules-engine/   pure reward logic + tests
packages/ui/             tokens, icons, brand components (WP-37)
packages/adapters/       menu adapters (nutrislice, schoolcafe, csv, ...)
supabase/migrations/     schema, RLS, functions
supabase/tests/          pgTAP (+ bootstrap/ for the Supabase compatibility shim)
e2e/                     Playwright (runs against Vercel previews)
scripts/                 db-test runner, migration lint
docs/                    these files
brand/                   brand asset kit
```

## Build order

1. **Spikes** where they gate work (see `05` §3): SPIKE-01 device sessions + Realtime under RLS and SPIKE-05 job limits before P0 device and job work; SPIKE-02 before calendar sync; SPIKE-04 before menu adapters; SPIKE-03 when the Pi and panel arrive.
2. **P0** foundation, **P1a** kid loop (incl. school year and points ledger), **P1b** rules engine + shop + streak history, **P1c** goals, **P1d** calendar + hardening, **P2** meals + menu + extras, **P3** polish. Milestone exit criteria are in `04` §E; work package order and dependencies are in `05`.
3. Work proceeds in dependency order. A milestone is done when its exit criteria pass in CI and on a preview; independent work packages may run in parallel. Sequence is chosen so no completed work package needs rework.
4. **Launch** once all milestones are done and the launch acceptance checklist (`04` §E) passes on the real Pi and panel.

## Conventions for Claude Code

- One branch and one PR per work package; prefix commits and test names with requirement IDs: `[CHR-04] ...`.
- Writes go through API routes or server actions; the board never writes to tables directly.
- Never take `household_id` from client input; derive it from the verified session.
- All schema changes via Supabase CLI migrations; every new table ships with RLS and pgTAP coverage.
- No Docker anywhere in the workflow. Database tests run on native Postgres (`scripts/db-test.sh`).
- Keep the rules engine free of I/O and clocks (inputs only).
- Keep `04` Stories, Work packages, coverage and component sections generated (`--fix`), not hand-edited.
- `chore_occurrence.status` and the points ledger are written only by the database functions in `02` §4.2 and §4.2b; never update them from application code.
- Update the affected artifact (`01`–`05`) in the same PR as the change, and log it in `04` §I.

## Resolved questions

| ID | Answer |
|---|---|
| OQ-01 | School district and menu platform are configured in the admin portal; not a spec concern. Adapter interface plus CSV/manual stays. |
| OQ-02 | One child; age does not matter. Multi-child support stays in the schema. |
| OQ-03 | Parents create chores; the child self-checks; a parent verifies in real life and can uncheck. Approval is a switch that can be turned on or off. |
| OQ-04 | Both goals and a points economy. |
| OQ-05 | Panel model unknown; build to 4K 32". |
| OQ-06 | Vercel Hobby project `family-wise` (`family-wise-topaz.vercel.app`, root directory `apps/web`); Supabase Free project `jpzwmibrsvsxcimbxtmb` for production plus a second Free project for previews; no staging environment; no paid plans (D-29). |
| OQ-07 | Magic link and password sign-in are required (D-25). |
| OQ-08 | A reversal simply takes the points away; negative balances are allowed. No expiry or cap specified. |
| OQ-09 | Goals are not sticky: a reversed completion un-achieves the goal and reverses its payout. |
| OQ-10 | Offline conflicts resolve by event timestamp (D-20). |
| OQ-11 | Why the school name matters: only to pick the lunch-menu adapter (SPIKE-04). The platform name alone is enough; no school name needs to be stored in the docs. |
| OQ-12 | The lunch menu is on Nutrislice, which has a public JSON API (SPIKE-04 done, `01` §5.5). The school is chosen in the admin portal. |
| OQ-13 | Yes: reminders for parents' tasks, and they must be switchable on and off (D-35). |

## Open questions

| ID | Question | Blocks |
|---|---|---|
| OQ-05b | Exact panel model and mounting (touch driver, height)? Hardware is being sourced. | SPIKE-03, WP-14, WP-34 |
| OQ-06b | Production domain name (after a trademark/domain check against "FamilyWize")? Not needed before P3. | ACC-06 / WP-38, custom SMTP for magic links beyond the Supabase team (`01` §9.10) |

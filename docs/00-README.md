# FamilyWise — Project Brief (v0.4)

A family "digital board" for a 32" 4K touch display (Raspberry Pi 5 kiosk): a child checks off chores, earns points, spends them in a rewards shop and watches progress toward goals; parents manage everything from phone or laptop. The board is only the interactive front end. Apple Calendar remains the system of record for events. Hosted on Vercel + Supabase.

## Document map

Claude Code produces, maintains and manages the five build artifacts below. Every PR that changes behavior, schema, scope or sequence updates the affected artifact in the same PR, bumps its version line, and adds a row to `04` §I.

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
| D-04 | Chore occurrences are materialized per assignee. A day-close job marks unfinished past-due occurrences `missed` and finalizes the day, so good and bad streaks can be shown over time. |
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
| D-21 | **Today only on the board.** The board shows today's chores only. Late credit for a past day is parent-only (`admin_complete`). A board event whose `occurred_at` falls outside the occurrence's due date (household-local) is stored as `flagged` and waits for a parent. |
| D-22 | Switching approval on or off re-resolves `scheduled` occurrences only. Check-offs already waiting for approval stay in the queue; completed ones are unchanged. |
| D-23 | Day-close finalizes both `scheduled` and `rejected` occurrences as `missed`. |
| D-24 | A school closure added for today leaves today's occurrences untouched; only later dates are regenerated. |
| D-25 | Admin sign-in: email magic link and email + password are required (ACC-02). Sign in with Apple and passkeys follow once the production domain is fixed (ACC-06). |
| D-26 | **Delivery without Docker or staging.** CI tests the database on a native Postgres with a Supabase compatibility bootstrap and pgTAP. Each PR gets a Vercel preview backed by its own Supabase preview branch. Merging to `main` applies migrations, then deploys the app, to the production project, which stays dark until launch (`01` §9). |
| D-27 | Three reward models stay as scoped: goals (with their own achieve → redeem lifecycle), shop redemptions, and wishlist pins. |
| D-28 | The points ledger is written only by `SECURITY DEFINER` database functions: earn and reversal by trigger; spend, refund, adjustment and bonus by named functions the API calls. |

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
| OQ-06 | Vercel for hosting; Supabase project `jpzwmibrsvsxcimbxtmb`; no staging environment. |
| OQ-07 | Magic link and password sign-in are required (D-25). |
| OQ-08 | A reversal simply takes the points away; negative balances are allowed. No expiry or cap specified. |
| OQ-09 | Goals are not sticky: a reversed completion un-achieves the goal and reverses its payout. |
| OQ-10 | Offline conflicts resolve by event timestamp (D-20). |

## Open questions

| ID | Question | Blocks |
|---|---|---|
| OQ-05b | Exact panel model and mounting (touch driver, height)? Hardware is being sourced. | SPIKE-03, WP-14, WP-34 |
| OQ-06b | Production domain name (after a trademark/domain check against "FamilyWize")? | ACC-06 / WP-38, production URL, email sender |

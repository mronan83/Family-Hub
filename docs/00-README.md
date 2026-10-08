# FamilyWise — Project Brief (v0.3)

A family "digital board" for a 32" 4K touch display (Raspberry Pi 5 kiosk): a child checks off chores, earns points, spends them in a rewards shop and watches progress toward goals; parents manage everything from phone or laptop. The board is only the interactive front end. Apple Calendar remains the system of record for events. Hosted on Vercel + Supabase.

## Document map

| File | Purpose |
|---|---|
| `01-target-architecture.md` | Context/container diagrams, components, runtime flows, security, offline, jobs, kiosk, failure modes |
| `02-data-model.md` | ERDs, table catalog, key DDL, RLS pattern, rules-engine contract |
| `03-user-stories.md` | 73 stories with Given/When/Then acceptance criteria |
| `04-requirements-traceability.md` | 84 requirements, traceability matrix, phases, risks, spikes, change log |
| `05-work-breakdown.md` | 37 work packages, dependency diagram, sizes, done-when criteria |
| `06-brand-and-style-guide.md` | FamilyWise brand: voice, logo, color, type, icons, components, accessibility, implementation notes |
| `brand/` | Asset kit: tokens, fonts, logos, app icons, 85 icons, avatars, `specimen.html` |
| `check_traceability.py` | CI check + generator for the matrix (`--fix`); checks stories and work packages |

Source of truth for IDs is `04`. Run `python check_traceability.py --docs . --tests .` in CI.

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
| D-17 | Everything derived from completion state is reversible: reversing a completion takes its points away (the balance can go negative) and un-achieves any goal it satisfied, reversing the payout. |
| D-18 | The product is named FamilyWise. Brand tokens and assets in `brand/` are the single source for color, type, and icons; the board never uses red for child-visible states and never relies on color alone (NFR-13). |
| D-15 | Admins choose which calendars each board shows (`device_calendar`). |
| D-16 | Reference panel is 3840×2160 at 32"; UI is laid out at 1920×1080 logical px with device scale factor 2. SPIKE-03 decides whether 4K animation is viable on the Pi 5 or the 1080p fallback applies. |

## Suggested repo layout

```
apps/web/            Next.js: app/(board), app/(admin), app/api
packages/rules-engine/   pure reward logic + tests
packages/adapters/       menu adapters (nutrislice, schoolcafe, csv, ...)
supabase/migrations/     schema, RLS, functions
supabase/tests/          pgTAP
e2e/                     Playwright (incl. offline, revocation, kiosk lockdown)
docs/                    these files
apps/web/public/icons    from brand/app-icons
packages/ui/             tokens, icons, brand components
```

## Build order

1. **Spikes first** (see `04` §G; work packages in `05`): SPIKE-01 device sessions + Realtime under RLS; SPIKE-03 touch panel on Pi; SPIKE-04 school menu platform.
2. **P0** foundation, **P1a** kid loop, **P1b** points + shop + streak history, **P1c** goals, **P1d** calendar + school year + hardening, **P2** meals + menu + extras, **P3** polish. Exit criteria are in `04` §E; the work package order and dependencies are in `05`.
3. Do not start the next phase until the family has used the current one for a week.

## Conventions for Claude Code

- Prefix commits and test names with requirement IDs: `[CHR-04] ...`.
- Writes go through API routes or server actions; the board never writes to tables directly.
- Never take `household_id` from client input; derive it from the verified session.
- All schema changes via Supabase CLI migrations; every new table ships with RLS and pgTAP coverage.
- Keep the rules engine free of I/O and clocks (inputs only).
- Keep `04` Stories, Work packages, coverage and component sections generated (`--fix`), not hand-edited.
- `chore_occurrence.status` and the points ledger are written only by the database functions in `02` §4.2; never update them from application code.

## Resolved questions

| ID | Answer |
|---|---|
| OQ-01 | School district and menu platform are configured in the admin portal; not a spec concern. Adapter interface plus CSV/manual stays. |
| OQ-02 | One child; age does not matter. Multi-child support stays in the schema. |
| OQ-03 | Parents create chores; the child self-checks; a parent verifies in real life and can uncheck. Approval is a switch that can be turned on or off. |
| OQ-08 | A reversal simply takes the points away; negative balances are allowed. No expiry or cap specified. |
| OQ-09 | Goals are not sticky: a reversed completion un-achieves the goal and reverses its payout. |
| OQ-04 | Both goals and a points economy. |
| OQ-05 | Panel model unknown; build to 4K 32". |

## Open questions

| ID | Question | Blocks |
|---|---|---|
| OQ-05b | Exact panel model and mounting (touch driver, height)? | SPIKE-03, WP-14 |
| OQ-06 | Vercel plan and domain name? | CAL-02, deployment |
| OQ-07 | Is Sign in with Apple required for both admins? | ACC-02 |

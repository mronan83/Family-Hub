# 04 — Requirements and Traceability

> Version 0.8 · Status: build baseline · Maintained by Claude Code
> This file is the **source of truth for requirement IDs**. Stories (`03`), work packages (`05`), components (`01`), and entities (`02`) trace to these IDs. `check_traceability.py` enforces the links in CI.

**ID scheme:** `<DOMAIN>-<NN>` · domains: `ACC` access · `DEV` device/board shell · `CHR` chores · `RWD` rewards · `CAL` calendar · `SCH` school year · `MEAL` meals · `MENU` school menu · `BRD` board UI · `PTS` points economy · `NFR` non-functional.
**Priority:** M = Must · S = Should · C = Could. **Phase:** P0 foundation · P1 kid loop and rewards (built as P1a kid loop, P1b rules engine/shop/streak history, P1c goals, P1d calendar/hardening) · P2 meals, menu and extras · P3 polish. Phases are build milestones; there is one launch, after P3 (D-19).
**Source:** User = stated by Matthew · Derived = needed to make a stated need work · Design = architectural/quality decision.
**Verification:** `U` unit (Vitest) · `DB` pgTAP · `INT` integration with fixtures/mocks · `E2E` Playwright · `HW` manual on Pi hardware · `REV` design/security review or drill.

---

## A. Requirements register

| ID | Requirement | Pri | Phase | Source |
|---|---|---|---|---|
| ACC-01 | The system shall support a household with an IANA timezone and week start, and scope all data to it. | M | P0 | Derived |
| ACC-02 | The system shall authenticate admins via email magic link and via email + password (with password reset); both methods are required. | M | P0 | User |
| ACC-03 | An admin shall be able to invite additional admins by email. | M | P0 | User |
| ACC-04 | Admins shall manage member profiles (child/adult) with name, avatar, and color; children shall not require logins; multiple children shall be supported. | M | P0 | User |
| ACC-05 | The system shall record an audit log of admin and device changes. | S | P3 | Design |
| ACC-06 | Admins may also sign in with Sign in with Apple or a passkey, enabled once the production domain is fixed. | S | P3 | User |
| DEV-01 | A board shall be paired via a single-use, short-lived code issued in the admin portal. | M | P0 | User |
| DEV-02 | A paired board shall have a scoped, revocable device identity limited to reading board data and submitting completions. | M | P0 | Design |
| DEV-03 | Admins shall list, rename, and revoke devices and see last-seen time. | M | P0 | Derived |
| DEV-04 | The kiosk shall be locked to `/board` with no accessible browser UI or admin routes. | M | P1 | User |
| DEV-05 | Admin changes shall appear on online boards within 3 seconds (p95). | M | P0 | User |
| DEV-06 | The board shall accept check-offs while offline, queue them, and replay them idempotently and in order. | M | P1 | Design |
| DEV-07 | The board shall support quiet hours and burn-in mitigation. | S | P3 | Design |
| DEV-08 | The board shall indicate when its data is stale. | S | P1 | Design |
| CHR-01 | Admins shall create, edit, and archive chores (routines) and tasks (to-dos, one-off or repeating) with title, icon, assignees (any family members), points, approval flag, household tags, optional due time, and visibility. | M | P1 | User |
| CHR-02 | Chores shall support recurrence (daily, weekly by weekday, monthly, once) and day-type filters. | M | P1 | User |
| CHR-03 | The system shall materialize one occurrence per item per due date for a rolling window, snapshot its assignees, and on edit re-plan only occurrences nothing has happened to, never past ones (D-45). | M | P1 | Design |
| CHR-04 | A family member shall check off an occurrence on the board with one tap, recording who did it, and undo within a configurable window via a compensating event. | M | P1 | User |
| CHR-05 | The approval workflow shall be switchable on or off for the household at any time, with a per-chore override. When off, a check-off counts immediately and a parent verifies in real life and can uncheck; when on, it is `pending_approval` until approved or rejected. | M | P1 | User |
| CHR-06 | Admins shall complete, uncomplete, or skip any occurrence. | M | P1 | Derived |
| CHR-07 | Each occurrence shall carry a persisted `status` (scheduled, completed, pending_approval, approved, rejected, skipped, missed) projected from the event log; a day-close job shall mark unfinished past-due routines `missed` and finalize the day (tasks carry over, CHR-12). The projection shall be rebuildable. | M | P1 | User |
| CHR-08 | Admins shall select and uncheck several occurrences at once; the resulting events share a batch id and any earned points are reversed. | M | P1 | User |
| CHR-09 | Any family member, child or adult, can be assigned, and one item can have several assignees. Each due date is a single shared occurrence: whoever completes it is recorded as having done it, it is done for every assignee, and it counts as covered (neutral) for assignees who did not do it. | M | P1 | User |
| CHR-10 | Admins shall define household tags (name, color, icon) and apply them to items; goals, filters, and insights reference tags by id, so renaming or archiving a tag never breaks a goal. | M | P1 | User |
| CHR-11 | An item may have a due time (household-local). The board orders and groups the day by it (morning, after school, evening, anytime) and marks items past their due time; scoring is unchanged. | M | P1 | User |
| CHR-12 | A task not done by its due date shall stay open and show as overdue until completed or cancelled; it is never marked missed, and a completion after the due date is recorded as late. | M | P1 | User |
| CHR-13 | An item shall be family-visible (on the board and to every admin) unless set private; a private item is visible only to the admin who created it and to assignees who sign in, enforced by RLS on the item, its occurrences, events, and audit rows. | M | P1 | User |
| CHR-14 | An admin shall have a My tasks view on the phone listing items assigned to them that are due today, overdue, or upcoming, with quick add. | M | P1 | User |
| CHR-15 | An admin shall be able to turn reminders on or off for themselves (off by default). When on, reminders arrive as web push notifications on each device they enable (the admin app on the iPhone Home Screen, or a desktop browser), and they can test or remove a device. | M | P2 | User |
| CHR-16 | Reminders shall be switchable per item for each person (a bell that follows the person's default or is set on or off), with a lead time (at the due time, or 15 minutes, 1 hour, or 1 day before); an item without a due time reminds at the person's morning time on its due date. Each item reminds each person at most once per occurrence and never after it is done. | M | P2 | User |
| CHR-17 | A person may turn on a daily digest at a chosen time listing their overdue and today's items, and set quiet hours that hold reminders until they end; notifications for private items hide the title on the lock screen. | M | P2 | User |
| CHR-18 | An item with several assignees shall be either shared (one occurrence per due date, done by whoever gets to it) or each person's own (one occurrence per assignee per due date, each with its own status and credit, due by that person's own day type). New chores default to each person's own, new tasks to shared. | M | P1 | User |
| RWD-01 | Admins shall create, edit, and archive reward goals with title, image, assignee, start date, and end date. | M | P1 | User |
| RWD-02 | Goals shall support rule types COUNT, STREAK, DAILY_ALL_DONE, and POINTS, scoped to all items, household tags (by id), or specific items. | M | P1 | User |
| RWD-03 | A goal shall combine its rules with ALL or ANY logic. | M | P1 | Derived |
| RWD-04 | Progress and goal achievement shall be derived from current completion state, rebuildable, and self-healing (dirty flag, reconcile within 5 minutes). A reversed completion shall un-achieve a goal that depended on it and reverse its payout. | M | P1 | User |
| RWD-05 | Streaks shall treat non-scheduled days as neutral, forgive a configurable number of misses per week, report best and current streak, and never count today as a miss. | M | P1 | Design |
| RWD-06 | Goals shall follow a lifecycle (draft, scheduled, active, achieved, redeemed, expired, cancelled) including time-based transitions. | M | P1 | Derived |
| RWD-07 | The board shall visualize progress per goal and nudge when a goal is near completion. | M | P1 | User |
| RWD-08 | The board shall celebrate chore completion and goal achievement (goal once), honoring reduced motion. | M | P1 | User |
| RWD-09 | Admins shall mark achieved goals as redeemed and view redemption history. | M | P1 | Derived |
| RWD-10 | Admins shall preview the effect of rule changes against historical data before saving. | S | P1 | Design |
| RWD-11 | Daily outcomes and runs of good and bad days (including missed days) shall be persisted per member so streak history can be shown over time. | M | P1 | User |
| RWD-12 | Admins shall view insights: current and best good streak, longest bad streak, completion rate over a range, a day heatmap, most-missed chores, completion by tag, and trust metrics (reversal and rejection rate, time to verify) to inform the approval setting. | S | P1 | Derived |
| RWD-13 | A goal shall define a payout on achievement: custom reward, a number of points, or a catalog item. | S | P1 | User |
| CAL-01 | Admins shall connect calendars by ICS URL, with the URL stored only in Vault. | M | P1 | User |
| CAL-02 | Calendars shall sync at least every 15 minutes and expand recurring events across a rolling window. | M | P1 | User |
| CAL-03 | Synced calendars shall be read-only; Apple Calendar remains the system of record for events. | M | P1 | User |
| CAL-04 | The board shall present day, week, and month calendar views scrollable by touch. | M | P1 | User |
| CAL-05 | Admins shall choose which connected calendars each board displays, with color and optional member association per calendar. | M | P1 | User |
| CAL-06 | Admins shall see sync health, and the board shall retain last good data when sync fails. | M | P1 | Design |
| CAL-07 | Calendar handling shall be correct for time zones, DST, and all-day events. | M | P1 | Design |
| CAL-08 | The system shall support CalDAV with an app-specific password and guidance to use a secondary read-only Apple ID. | C | P2 | Design |
| SCH-01 | Admins shall configure school years (dates, terms, breaks, no-school days); multiple years shall coexist. | M | P1 | User |
| SCH-02 | The system shall resolve a day type (`school_day`, `no_school`, `break`, `weekend`, `summer`) per member and date. | M | P1 | User |
| SCH-03 | Day types shall drive chore generation and lunch eligibility. | M | P1 | User |
| SCH-04 | Admins may import no-school days from a tagged calendar source after previewing them. | C | P3 | Derived |
| MEAL-01 | The system shall support a weekly plan with breakfast, snack, lunch, and dinner slots for every day. | M | P2 | User |
| MEAL-02 | The system shall provide a reusable meal library and allow free-text entries. | M | P2 | Derived |
| MEAL-03 | Admins shall copy a previous week with a skip-or-overwrite choice. | S | P2 | Derived |
| MEAL-04 | Lunch shall be recorded as buy or bring per child per school day, with weekday defaults and per-date overrides. | M | P2 | User |
| MEAL-05 | Buy days shall display the school menu items for that date. | M | P2 | User |
| MEAL-06 | The board shall show today's meals and a weekly view, read-only. | M | P2 | Derived |
| MEAL-07 | Meals shall store structured ingredients so a grocery list can be added later. | C | P3 | Design |
| MEAL-08 | A slot shall allow multiple ordered entries (for example snacks), scoped to the household or a member. | S | P2 | Derived |
| MENU-01 | Admins shall configure a menu source and link it to a child's school profile. | M | P2 | User |
| MENU-02 | Menu import shall use a pluggable adapter interface (Nutrislice, SchoolCafe, Linq Connect, CSV, manual). | M | P2 | Design |
| MENU-03 | Admins shall import menus from CSV or edit a day manually; edits are overrides that adapters never overwrite. | M | P2 | Design |
| MENU-04 | Menus shall be cached, failures surfaced, and meal planning never blocked by a failed import. | M | P2 | Design |
| MENU-05 | Menus shall refresh daily over a 28-day window. | S | P2 | Design |
| BRD-01 | The board shall have a Today screen with chores, events, meals, and goal progress. | M | P1 | User |
| BRD-02 | The board shall let a family member select their profile and filter to their items, and, for a member who earns rewards, their points and goals. | M | P1 | Derived |
| BRD-03 | Child-facing UI shall be icon-first with touch targets of at least 56 logical px (about 21 mm on the 4K reference panel; target 96 or more for primary actions) and text legible at 2 m. | M | P1 | User |
| BRD-04 | The board may show a local weather widget. | C | P3 | User |
| BRD-05 | Admins shall configure which panels appear and their order. | S | P3 | Derived |
| BRD-06 | The board shall return to Today after 60 seconds of inactivity, deferring while a celebration plays. | M | P1 | Design |
| BRD-07 | The board shall show a Family view of today: every member's family-visible items and open overdue tasks, grouped by part of day with whose each item is (on the home screen, D-66; a column per person on Chores), where anyone can check off an item and pick who did it. | M | P1 | User |
| NFR-01 | The board shall remain functional offline for at least 24 hours from cached data. | M | P1 | Design |
| NFR-02 | The board shall target a 3840×2160 32" panel, laid out at 1920×1080 logical px with device scale factor 2, be interactive in under 2 s from cache on a Pi 5, and give check-off feedback under 100 ms. | M | P1 | User |
| NFR-03 | Child-facing interactions shall tolerate imprecise touch (debounce, confirm destructive actions). | M | P1 | Design |
| NFR-04 | RLS shall be enabled on every table and tested; secrets shall never reach the client. | M | P0 | Design |
| NFR-05 | Child PII shall be minimized, no third-party trackers used, and household data exportable and deletable. | S | P3 | Design |
| NFR-06 | Completion events shall be append-only with UTC instants, local credit dates, and idempotency keys. | M | P1 | Design |
| NFR-07 | The system shall provide structured logs, error tracking, and job health visibility. | S | P1 | Design |
| NFR-08 | The system shall run on free plans with a documented cost ceiling, and production shall be kept from pausing on inactivity (keepalive with failure alerts). | S | P0 | User |
| NFR-09 | Every table shall carry `household_id` and isolate tenants (multi-tenant-ready). | M | P0 | Design |
| NFR-10 | Production data shall be backed up daily (encrypted, off the database host) with a documented, rehearsed restore. | M | P1 | Design |
| NFR-11 | The UI shall meet WCAG AA contrast, avoid color-only cues, and honor reduced motion. | S | P2 | Design |
| PTS-01 | Points shall be posted to an append-only ledger: earned by each credited member who earns rewards when an occurrence enters a done status, reversed when it leaves one, with manual adjustments and idempotent dedupe keys. | M | P1 | User |
| PTS-02 | The board shall show the member's points balance and recent activity; a negative balance shall display as a debt. | M | P1 | User |
| PTS-03 | Admins shall create, edit and archive a catalog of rewards and activities with point costs, images and optional stock. | M | P1 | User |
| PTS-04 | A child shall request a catalog item; requests shall not exceed the available balance; an admin approves (posting the spend), denies, or fulfills. A reversal after a spend takes the points away and may leave a negative balance. | M | P1 | User |
| PTS-05 | Admins may define automatic bonus rules (for example a streak milestone) that post bonus points once. | S | P2 | Derived |
| PTS-06 | A child may pin a catalog item as a saving goal and see progress toward its cost. | S | P2 | Derived |
| PTS-07 | Each member shall have an earns-rewards switch, on by default for a child and off for an adult. Only credited members with it on earn points, go through approval, count toward goals, and show reward streaks. | M | P1 | User |
| NFR-12 | The rules engine shall have at least 90% unit coverage, RLS shall be pgTAP-tested, and CI shall gate on e2e including offline. | M | P0 | Design |
| NFR-13 | The product shall be branded FamilyWise and implement the brand and style guide: design tokens (light and Evening themes), self-hosted fonts, logo and app icons, the 85-icon set, member avatars, and a status-to-visual mapping with icon, label and color for every occurrence status. | M | P0 | User |
| NFR-14 | Every change shall reach production only through a pull request that passes CI gates (lint, typecheck, unit, pgTAP, traceability, build) and e2e on its preview deployment, which runs as the demo family in the one database with the PR's additive migrations applied, and that the owner has approved after viewing its preview; merging applies migrations before deploying the app. No Docker and no staging environment. | M | P0 | User |

---

## B. Traceability matrix

Stories and Work packages are generated from `03-user-stories.md` and `05-backlog.md` (`Reqs:` lines). Do not hand-edit those two columns; run `check_traceability.py` to detect drift.

| Req | Stories | Work packages | Components | Data entities | Verification |
|---|---|---|---|---|---|
| ACC-01 | US-101 | WP-02, WP-03 | ADM, DB | household, household_settings | DB, E2E |
| ACC-02 | US-102 | WP-03 | ADM, SAUTH | household_user | E2E, U |
| ACC-03 | US-103 | WP-03 | ADM, API, SAUTH | invite, household_user | E2E, DB |
| ACC-04 | US-104 | WP-04 | ADM, DB | member | E2E, DB, U |
| ACC-05 | US-105 | WP-03, WP-32 | DB, ADM | audit_log | DB, E2E |
| ACC-06 | US-106 | WP-38 | ADM, SAUTH | household_user | E2E |
| DEV-01 | US-201 | WP-05 | ADM, API, AUTH, BRD, SAUTH | device_pairing, device | E2E, DB |
| DEV-02 | US-201, US-202 | WP-05 | AUTH, DB, SAUTH | device | DB |
| DEV-03 | US-202 | WP-05 | ADM, AUTH | device | E2E |
| DEV-04 | US-203 | WP-14 | PI, BRD | — | HW, E2E |
| DEV-05 | US-204 | WP-06 | RT, BRD, DB | board_snapshot, all board-readable tables | U, DB, E2E |
| DEV-06 | US-205 | WP-13 | OUTBOX, BRD, API | chore_completion_event | E2E, U |
| DEV-07 | US-207 | WP-34 | PI, BRD | household_settings | HW |
| DEV-08 | US-206 | WP-13 | BRD, OBS | job_run | E2E, U, DB |
| CHR-01 | US-301 | WP-08 | ADM, API | chore, chore_assignee | U, DB, E2E |
| CHR-02 | US-302 | WP-09 | OCCGEN, DB | chore, school_closure | U, DB, E2E |
| CHR-03 | US-303, US-308, US-311 | WP-09 | OCCGEN, SCHED, DB | chore_occurrence | DB, U, E2E |
| CHR-04 | US-304, US-305, US-1006 | WP-10, WP-11 | BRD, OUTBOX, API, DB | chore_completion_event, chore_occurrence | E2E, DB, U |
| CHR-05 | US-306, US-310 | WP-12 | ADM, API | chore_completion_event | E2E |
| CHR-06 | US-307, US-309 | WP-12 | ADM, API | chore_completion_event | E2E |
| CHR-07 | US-307, US-314 | WP-10 | DB, SCHED, BRD, ADM | chore_occurrence, chore_completion_event | DB, U, E2E |
| CHR-08 | US-309 | WP-12 | ADM, API, DB | chore_completion_event, points_ledger | E2E, DB |
| CHR-09 | US-304, US-311, US-316, US-320 | WP-08, WP-09, WP-10, WP-43 | ADM, BRD, API, OCCGEN, DB | chore_assignee, chore_occurrence_assignee, chore_completion_event | DB, E2E |
| CHR-10 | US-312 | WP-08, WP-15, WP-19 | ADM, RULES, DB | tag, chore_tag, reward_rule | DB, U, E2E |
| CHR-11 | US-313 | WP-08, WP-09, WP-11 | ADM, BRD, OCCGEN | chore, chore_occurrence | E2E, U |
| CHR-12 | US-303, US-314 | WP-09, WP-10, WP-11 | OCCGEN, SCHED, DB, BRD | chore_occurrence | DB, INT, E2E |
| CHR-13 | US-315 | WP-08 | ADM, BRD, API, DB | chore, chore_assignee, chore_tag, audit_log | U, DB, E2E |
| CHR-14 | US-316 | WP-12 | ADM | chore_occurrence_assignee | E2E |
| CHR-15 | US-317 | WP-40 | NOTIFY, ADM, DB | push_subscription, reminder_preference | E2E, DB, U |
| CHR-16 | US-318 | WP-40 | NOTIFY, SCHED, ADM, DB | chore_assignee, reminder_delivery | DB, INT, E2E, U |
| CHR-17 | US-319 | WP-40 | NOTIFY, ADM, DB | reminder_preference, reminder_delivery | DB, INT, E2E, U |
| CHR-18 | US-320 | WP-43 | ADM, OCCGEN, DB | chore, chore_occurrence | DB, U, E2E |
| RWD-01 | US-401 | WP-19 | ADM, API | reward_goal | E2E |
| RWD-02 | US-312, US-401 | WP-15 | RULES, DB | reward_rule, tag | U |
| RWD-03 | US-401 | WP-15 | RULES | reward_goal | U |
| RWD-04 | US-406, US-407 | WP-19, WP-39 | RULES, API, SCHED, DB | reward_rule_progress, reward_goal_progress | U, INT, DB |
| RWD-05 | US-402 | WP-15 | RULES | reward_rule | U |
| RWD-06 | US-405 | WP-19 | RULES, SCHED, API | reward_goal, reward_goal_event | U, INT |
| RWD-07 | US-403 | WP-20, WP-44 | BRD | reward_goal_progress | E2E |
| RWD-08 | US-404 | WP-11, WP-20 | BRD | reward_goal | E2E |
| RWD-09 | US-405 | WP-19 | ADM, API | reward_goal, reward_goal_event | E2E |
| RWD-10 | US-406 | WP-39 | ADM, RULES | reward_goal, reward_rule | U, E2E |
| RWD-11 | US-408 | WP-15, WP-17 | DB, SCHED, RULES | member_daily_summary, streak_segment | U, DB, INT, E2E |
| RWD-12 | US-408 | WP-17 | ADM, RULES | member_daily_summary, streak_segment | E2E, U, DB |
| RWD-13 | US-409 | WP-39 | RULES, API, DB | reward_goal, points_ledger, redemption | U, INT |
| CAL-01 | US-501 | WP-22 | ADM, CALSYNC, VAULT | calendar_source | INT, E2E |
| CAL-02 | US-502 | WP-22 | CALSYNC, SCHED | calendar_event, calendar_event_instance | U, INT |
| CAL-03 | US-501 | WP-22 | CALSYNC, ADM, BRD | — | REV |
| CAL-04 | US-503 | WP-23 | BRD | calendar_event_instance | E2E |
| CAL-05 | US-504, US-507 | WP-23 | ADM, BRD, DB | calendar_source, device_calendar | E2E, DB |
| CAL-06 | US-505 | WP-22 | CALSYNC, ADM, OBS | calendar_source, job_run | INT, E2E |
| CAL-07 | US-502 | WP-22 | CALSYNC | calendar_event, calendar_event_instance | U |
| CAL-08 | US-506 | WP-29 | CALSYNC, VAULT | calendar_source | INT |
| SCH-01 | US-601 | WP-21 | ADM, DB | school_year, school_term, school_closure, member_school_profile | U, DB, E2E |
| SCH-02 | US-602 | WP-21 | DB | resolve_day_type | DB, E2E |
| SCH-03 | US-302, US-602 | WP-09, WP-21 | OCCGEN, DB | chore, chore_occurrence | DB, E2E |
| SCH-04 | US-603 | WP-36 | ADM, CALSYNC | school_closure, calendar_event_instance | INT |
| MEAL-01 | US-701 | WP-25 | ADM, BRD | meal_plan_entry | E2E |
| MEAL-02 | US-701 | WP-25 | ADM | meal, meal_plan_entry | E2E |
| MEAL-03 | US-702 | WP-25 | ADM, API | meal_plan_entry | E2E, INT |
| MEAL-04 | US-703 | WP-26 | ADM, DB | lunch_override, member_school_profile | DB, E2E |
| MEAL-05 | US-704 | WP-27 | MENUIMP, BRD, ADM | school_menu_day, lunch_override | E2E |
| MEAL-06 | US-705 | WP-28 | BRD | meal_plan_entry, lunch_override | E2E |
| MEAL-07 | US-706 | WP-36 | ADM | meal | U |
| MEAL-08 | US-701 | WP-25 | ADM | meal_plan_entry | E2E |
| MENU-01 | US-801 | WP-27 | ADM, MENUIMP | menu_source, member_school_profile | E2E |
| MENU-02 | US-801 | WP-27 | MENUIMP | menu_source | U, INT |
| MENU-03 | US-802 | WP-27 | ADM, MENUIMP | school_menu_day | E2E, INT |
| MENU-04 | US-803 | WP-27 | MENUIMP, ADM, OBS | school_menu_day, job_run | INT |
| MENU-05 | US-803 | WP-27 | MENUIMP, SCHED | school_menu_day | INT |
| BRD-01 | US-303, US-1001 | WP-11, WP-35 | BRD | board_snapshot | E2E |
| BRD-02 | US-1002 | WP-11 | BRD | member | E2E |
| BRD-03 | US-905 | WP-11 | BRD | — | E2E, HW, REV |
| BRD-04 | US-1003 | WP-45 | BRD, API | household_settings, weather_reading | E2E |
| BRD-05 | US-1004 | WP-35 | ADM, BRD | household_settings, device | E2E |
| BRD-06 | US-1005 | WP-14 | BRD | — | E2E |
| BRD-07 | US-1006 | WP-11, WP-35 | BRD, API | chore_occurrence, chore_occurrence_assignee | E2E |
| NFR-01 | US-205 | WP-13, WP-44 | OUTBOX, BRD | — | E2E, U, HW |
| NFR-02 | US-905 | WP-14 | BRD, PI | — | HW, E2E |
| NFR-03 | US-905 | WP-11 | BRD | — | HW, E2E |
| NFR-04 | US-102, US-901 | WP-02, WP-03, WP-05 | DB, VAULT, SAUTH, API | all tables | DB, REV |
| NFR-05 | US-902 | WP-33 | ADM, API, DB | household, member | E2E, INT |
| NFR-06 | US-907 | WP-10 | DB, API | chore_completion_event | DB, U, E2E |
| NFR-07 | US-904 | WP-07, WP-42 | OBS, API, SCHED | job_run, private.job_schedule, private.app_error | U, DB, E2E, REV |
| NFR-08 | US-909 | WP-01, WP-41, WP-42 | CICD, OBS | private.usage_sample | U, DB, E2E, REV |
| NFR-09 | US-101, US-901 | WP-02 | DB | all tables | DB |
| NFR-10 | US-903 | WP-24 | DB | — | REV |
| NFR-11 | US-906 | WP-31 | BRD, ADM, UI | — | E2E, REV |
| PTS-01 | US-309, US-1101, US-1106 | WP-16 | DB, API, ADM | points_ledger, chore_occurrence | DB, U, E2E |
| PTS-02 | US-1102 | WP-11, WP-16, WP-20 | BRD, DB | v_points_balance, points_ledger | E2E |
| PTS-03 | US-1103 | WP-18 | ADM, API, BRD | reward_catalog_item | E2E, DB |
| PTS-04 | US-1104, US-1105 | WP-18, WP-20 | BRD, ADM, API, DB, OUTBOX | redemption, points_ledger, reward_catalog_item | E2E, DB, INT |
| PTS-05 | US-1107 | WP-30 | SCHED, RULES, ADM, DB | points_rule, points_ledger, streak_segment, member_daily_summary | U, DB, E2E |
| PTS-06 | US-1108 | WP-30 | BRD, API, ADM, DB | wishlist_pin, reward_catalog_item, v_points_balance | U, DB, E2E |
| PTS-07 | US-1109 | WP-02, WP-04, WP-16 | ADM, DB, RULES | member, points_ledger | DB, E2E |
| NFR-12 | US-908, US-911 | WP-01, WP-02, WP-15 | all | — | CI |
| NFR-13 | US-910 | WP-37 | BRD, ADM, UI | — | E2E, REV |
| NFR-14 | US-911 | WP-01, WP-41 | CICD | — | CI, REV |

---

## C. Coverage summary

| Phase | Must | Should | Could | Total |
|---|---|---|---|---|
| P0 | 13 | 1 | 0 | 14 |
| P1 | 52 | 5 | 0 | 57 |
| P2 | 12 | 6 | 1 | 19 |
| P3 | 0 | 5 | 3 | 8 |
| **Total** | **77** | **17** | **4** | **98** |

- Requirements: **98** · with at least one story: **98** · stories: **87** (P0: 12 · P1: 52 · P2: 15 · P3: 8).
- With at least one work package: **98** · work packages: **45**.
- Generated by `check_traceability.py --fix`; do not edit by hand.

---

## D. Component index (reverse trace)

| Component | Requirements |
|---|---|
| `BRD` | BRD-01, BRD-02, BRD-03, BRD-04, BRD-05, BRD-06, BRD-07, CAL-03, CAL-04, CAL-05, CHR-04, CHR-07, CHR-09, CHR-11, CHR-12, CHR-13, DEV-01, DEV-04, DEV-05, DEV-06, DEV-07, DEV-08, MEAL-01, MEAL-05, MEAL-06, NFR-01, NFR-02, NFR-03, NFR-11, NFR-13, PTS-02, PTS-03, PTS-04, PTS-06, RWD-07, RWD-08 |
| `ADM` | ACC-01, ACC-02, ACC-03, ACC-04, ACC-05, ACC-06, BRD-05, CAL-01, CAL-03, CAL-05, CAL-06, CHR-01, CHR-05, CHR-06, CHR-07, CHR-08, CHR-09, CHR-10, CHR-11, CHR-13, CHR-14, CHR-15, CHR-16, CHR-17, CHR-18, DEV-01, DEV-03, MEAL-01, MEAL-02, MEAL-03, MEAL-04, MEAL-05, MEAL-07, MEAL-08, MENU-01, MENU-03, MENU-04, NFR-05, NFR-11, NFR-13, PTS-01, PTS-03, PTS-04, PTS-05, PTS-06, PTS-07, RWD-01, RWD-09, RWD-10, RWD-12, SCH-01, SCH-04 |
| `API` | ACC-03, BRD-04, BRD-07, CHR-01, CHR-04, CHR-05, CHR-06, CHR-08, CHR-09, CHR-13, DEV-01, DEV-06, MEAL-03, NFR-04, NFR-05, NFR-06, NFR-07, PTS-01, PTS-03, PTS-04, PTS-06, RWD-01, RWD-04, RWD-06, RWD-09, RWD-13 |
| `AUTH` | DEV-01, DEV-02, DEV-03 |
| `RULES` | CHR-10, PTS-05, PTS-07, RWD-02, RWD-03, RWD-04, RWD-05, RWD-06, RWD-10, RWD-11, RWD-12, RWD-13 |
| `OCCGEN` | CHR-02, CHR-03, CHR-09, CHR-11, CHR-12, CHR-18, SCH-03 |
| `CALSYNC` | CAL-01, CAL-02, CAL-03, CAL-06, CAL-07, CAL-08, SCH-04 |
| `MENUIMP` | MEAL-05, MENU-01, MENU-02, MENU-03, MENU-04, MENU-05 |
| `NOTIFY` | CHR-15, CHR-16, CHR-17 |
| `OUTBOX` | CHR-04, DEV-06, NFR-01, PTS-04 |
| `SCHED` | CAL-02, CHR-03, CHR-07, CHR-12, CHR-16, MENU-05, NFR-07, PTS-05, RWD-04, RWD-06, RWD-11 |
| `DB` | ACC-01, ACC-04, ACC-05, CAL-05, CHR-02, CHR-03, CHR-04, CHR-07, CHR-08, CHR-09, CHR-10, CHR-12, CHR-13, CHR-15, CHR-16, CHR-17, CHR-18, DEV-02, DEV-05, MEAL-04, NFR-04, NFR-05, NFR-06, NFR-09, NFR-10, PTS-01, PTS-02, PTS-04, PTS-05, PTS-06, PTS-07, RWD-02, RWD-04, RWD-11, RWD-13, SCH-01, SCH-02, SCH-03 |
| `RT` | DEV-05 |
| `VAULT` | CAL-01, CAL-08, NFR-04 |
| `SAUTH` | ACC-02, ACC-03, ACC-06, DEV-01, DEV-02, NFR-04 |
| `PI` | DEV-04, DEV-07, NFR-02 |
| `OBS` | CAL-06, DEV-08, MENU-04, NFR-07, NFR-08 |
| `UI` | NFR-11, NFR-13 |
| `CICD` | NFR-08, NFR-14 |

`all` (NFR-12) applies to every component. Generated by `check_traceability.py --fix`.

---

## E. Milestones, exit criteria and launch

Work packages (`05-backlog.md`) are assigned to these milestones. A milestone is done when its exit criteria pass in CI and on a preview environment. Milestones are not release gates: nothing goes live until every milestone is done and the launch acceptance checklist below passes (D-19). Independent work packages may run in parallel; the sequence is chosen so that no finished work package needs rework.

| Milestone | Scope | Exit criteria (CI + preview) |
|---|---|---|
| **P0 Foundation** | Repo, CI/CD pipeline, tenancy schema + RLS, admin auth, members, device pairing, board shell, realtime, job framework, brand system | All PR gates green; pgTAP isolation and revoked-device tests green; on a preview, an admin signs in by password (the magic link is unit-tested, and checked in production by L-12), creates a household and child, pairs a browser as a board, and sees a rename within 3 s; production deploy pipeline (migrate → app → smoke) green |
| **P1a Kid loop** | School year + day types, chores, occurrences, completion events + persisted status + day-close, points ledger, Today screen with balance and chore celebration, admin chore ops (approve, uncheck, bulk uncheck), offline outbox, 4K kiosk host | Day-type precedence tests green; E2E: check-off, undo, double tap, bulk uncheck with matching ledger reversals, approval on/off; offline replay with zero lost or duplicate events and event-time conflict resolution; day-close marks `scheduled` and `rejected` as `missed`; rebuild reports no drift after property tests; a shared item credits only who did it and is covered for the others; an overdue task carries over while a routine becomes missed; a private item is invisible on the board and to the other admin |
| **P1b Rules engine, shop, streak history** | Rules engine, streak history + insights, catalog, redemptions | Property tests green; request → approve → fulfil end to end with two concurrent requests unable to overspend; insights match a hand-computed 14-day fixture |
| **P1c Goals** | Goal admin, progress pipeline, payouts and reversals, board points/shop/goals UI, celebrations | A seeded goal is achieved, paid out once, un-achieved by a reversal (payout reversed) and re-achieved; reconcile heals a dirtied goal |
| **P1d Calendar and hardening** | ICS sync, calendar views + per-device selection, backups, runbooks | ICS fixtures (DST, all-day, cancelled, moved) green; per-device selection reflected within 3 s; restore drill recorded |
| **P2 Meals, menu, extras** | Meal plan, library, buy/bring, menu adapter(s) + CSV, CalDAV, bonus rules, wishlist, accessibility pass | Week planning, copy-week and buy/bring flows green; 4 weeks of menu load from CSV; a failing adapter keeps cached menus; bonus posts once; accessibility checks green; a reminder fires once and on time, never after the item is done, and stops when switched off |
| **P3 Polish** | Audit log, export/delete, quiet hours, weather, layout config, grocery-ready ingredients, closure import, Sign in with Apple and passkeys | Each work package's done-when passes; every mutating route writes an audit row |

### Launch acceptance (run once, on the real Pi and panel, after P3)

| # | Check | Source |
|---|---|---|
| L-01 | A child checks off chores for 7 days, including an induced wifi outage, with zero lost or duplicate events; a missed day is recorded as `missed` | former P1a exit |
| L-02 | Points balance reconciles to the ledger after 14 days of real use; a reward is requested, approved and fulfilled | former P1b exit |
| L-03 | One real goal tracked for 14 days with parent-verified progress; payout posts exactly once | former P1c exit |
| L-04 | Board matches the phone calendar for 14 days, showing only the chosen calendars | former P1d exit |
| L-05 | Kiosk boots to the board unattended and recovers from a power pull; 7-day soak with no manual intervention | former P1d exit, WP-14 |
| L-06 | Restore drill completed against the production backup | NFR-10 |
| L-07 | A full school week is planned in under 10 minutes; 4 weeks of menu load via adapter or CSV | former P2 exit |
| L-08 | Hardware checklist (§F) passes: touch latency, calibration, boot-to-board time, dim/sleep, SPIKE-03 animation budget | HW |
| L-09 | Production data reset with the launch runbook; household created with a setup code; second admin invited and joined with a password; board paired | `01` §9.7 |
| L-10 | Each parent receives reminders on their own iPhone for 7 days: on time, once per item, none after an item is done, none during quiet hours, private titles hidden; turning reminders off stops them | CHR-15..17 |
| L-11 | Vercel usage over the 7-day soak (L-05), scaled to a month, stays under half of each Hobby allowance: invocations, Active CPU, provisioned memory | NFR-08, `01` §5.6 |
| L-12 | With Supabase Auth's URL settings and sign-up switch in place (Y-9, done): the owner signs in to production by magic link and by password, resets the password by link, and a sign-up attempt through the API is refused | ACC-02, `01` §5.10 |

---

## F. Verification conventions

- Test names include requirement IDs: `[CHR-04] check-off is idempotent on replay`.
- pgTAP files: `supabase/tests/<domain>_<req>.test.sql`.
- Rules engine: Vitest + `fast-check` property tests (random event orderings, DST boundaries, replay idempotency).
- Playwright e2e must include: offline check-off + replay, device revocation, stale indicator, kiosk route lockdown, idle return, realtime latency budget.
- Calendar fixtures: recurring weekly across DST, all-day multi-day, cancelled instance, moved instance (RECURRENCE-ID), unicode titles.
- Hardware acceptance (`HW`) is a checklist run on the real Pi + panel: touch latency, calibration, boot-to-board time, power-pull recovery, dim/sleep.

---

## G. Risks, spikes, assumptions

### Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | Reward novelty decays; board becomes wallpaper | High | High | Experiences as rewards, grace days, short goal windows, parent-tunable rules; review daily completion rate at week 4 |
| R-02 | Rule engine complexity creep | Med | Med | Four rule types only; goal templates; keep engine pure and property-tested |
| R-03 | A kiosk's session is revoked by Supabase's refresh-token reuse detection after a refresh lost on flaky wifi, and the board stops until someone re-pairs it | Med | Med | SPIKE-01 done: the board keeps its credential (httpOnly cookie) and signs itself in again unattended (`/board/resume`, tested in e2e); Realtime under RLS confirmed in e2e (D-40) |
| R-04 | iCloud published-calendar behavior changes or lacks fidelity | Med | Med | SPIKE-02; CalDAV fallback; last-good retention |
| R-05 | School menu feed unavailable or unofficial | Med | Med | The district's Nutrislice feed is public but undocumented, so it could change: adapter isolated behind the interface, last good menu cached, CSV/manual fallback, failures surfaced (MENU-04) |
| R-06 | Supabase Free project paused for inactivity, or vendor outage | Med | High | Keepalive heartbeat four times a day; failure email; restore runbook; offline cache keeps the board usable |
| R-07 | Pi hardware (SD corruption, touch driver, panel latency) | Med | High | NVMe/SSD boot; SPIKE-03 on the real panel |
| R-08 | Maintenance burden on a single builder | High | High | Automated PR gates and ordered deploys; no feature that needs weekly care; health page and alerts |
| R-09 | Child data privacy | Low | High | Minimal fields, no trackers, export/delete |
| R-10 | Time bugs (DST, timezone, day rollover) | Med | High | Household timezone authoritative; fixtures and property tests |
| R-11 | Vercel cron/function duration limits | Med | Med | `pg_cron` + `pg_net`; one-source-per-invocation; SPIKE-05 |
| R-12 | Points economy: inflation, a reversal after a spend creating a debt, parents forgetting to fulfil | Med | Med | Costs are admin-tunable; negative balances shown neutrally as points to earn back; request check uses balance minus open requests; admin adjustments are ledger entries with reasons |
| R-13 | Self-check with parent verification in real life invites "check everything" behavior | Med | Med | Bulk uncheck (CHR-08) with a batch id; optional approval per chore; insights show override rate; no punitive wording on the board |
| R-14 | 4K rendering on Pi 5 is too slow for animations | Med | Med | SPIKE-03; logical 1080p layout with DPR 2; compositor-only animations; documented 1080p output fallback |
| R-15 | Day-close job skipped or late, leaving stale `scheduled` days | Low | Med | Hourly idempotent job with catch-up; stale-day alert on the health page; `rebuild_occurrence_status` drift check |
| R-16 | Database tests run on native Postgres with a compatibility bootstrap (no Docker), which can drift from real Supabase | Med | Med | Bootstrap mirrors only platform objects; the e2e workflow applies each PR's additive migrations to the real project before merge; any other migration is first applied by the deploy, which stops before the app ships if it fails; production smoke check |
| R-17 | Pi and panel not yet available, so the 4K budget (SPIKE-03) is validated late | Med | Med | Build to the 1920×1080 logical / DPR 2 spec; compositor-only animations; desktop Chromium at 3840×2160 DPR 2 in e2e; WP-14 and launch check L-08 run when hardware arrives |
| R-18 | Device clock skew affects event-time conflict resolution | Low | Med | Server clamps `occurred_at` to receipt time; board events outside the due date are flagged for a parent (D-20, D-21) |
| R-19 | Supabase's built-in email reaches only team members, about 2 per hour, so magic links and resets can fail | High | Med | Password sign-in needs no email; invites are shareable links; add both parents to the Supabase team; custom SMTP once a domain exists (OQ-06b) |
| R-20 | No automatic backups on Supabase Free | Med | High | Nightly encrypted `pg_dump` kept 30 days; rehearsed restore into a throwaway database (WP-24, L-06) |
| R-21 | Free-plan limits or policies change | Low | Med | Usage on System Health; the cost ceiling records that a paid upgrade is a deliberate decision |
| R-22 | Parents keep their own to-dos in other apps, so the family list goes stale and the board loses trust | Med | High | My tasks on the phone with quick add (CHR-14); the Family view shows everyone's day; reminders by web push, switchable per person (D-35) |
| R-23 | A private item leaks through the board snapshot, an audit row, or the other admin's view | Low | High | One RLS rule on the item, its occurrences, events and audit rows; pgTAP proves the board and the other admin see nothing; the snapshot reads through RLS |
| R-24 | Web push on iPhone works only for the admin app added to the Home Screen with permission granted, and Apple can change the rules | Med | Med | Onboarding step with a test notification; Settings lists each device's last delivery; My tasks and the board work without push; launch check L-10 on real phones |
| R-25 | Production secrets are repository secrets, readable by any workflow run on any branch (GitHub Free, private repository) | Low | High | Only the owner and Claude Code push; workflow changes are reviewed in the pull request diff; the Vercel token is scoped to the team and expires; the database password and the token can be rotated from their dashboards |
| R-26 | A commit reaches `main` without passing its checks, since GitHub Free does not enforce branch protection on a private repository | Low | Med | The deploy gate refuses to ship it and the failed run emails the owner; fix forward in a pull request or revert (D-36). Each refusal is tested in `ci / checks`, so a change that weakens the gate fails CI |
| R-27 | Previews run unapproved code against the production database | Low | High | Previews hold only the browser-safe key, so RLS applies to everything they do; they run as the demo family, which RLS keeps apart from yours (pgTAP); only additive migrations are applied before approval; previews sit behind a Vercel login; nothing in the pipeline wipes the database (D-37) |
| R-28 | A slow job call holds every other job call: pg_net starts its next batch only when every call in the current one has finished (SPIKE-05) | Med | Med | Job endpoints answer 202 at once and work after the response (`after()`); pg_net timeout 30 s; one minute per schedule; `job_run` staleness on the health page (`01` §5.6) |
| R-29 | The app uses up a Hobby allowance (Active CPU is the tightest: cold starts cost about 0.4 s of CPU each), and Vercel pauses the project, which resumes only by hand | Low | High | Jobs use under 10 % of each allowance when calls stay warm and sequential (`01` §5.6 budget); launch check L-11 measures the whole app before launch |
| R-31 | Demo sign-ins also work on production's sign-in page, since previews and production share one Supabase project | Low | Low | They reach only the demo family, which holds made-up data; production never offers the one-tap buttons; their passwords come from the bypass secret, so rotating it (Vercel → Deployment Protection, then the GitHub secret) changes them at the next e2e run; a demo sign-in can create a household only with a setup code (D-39) |
| R-32 | An invite link reaches someone other than the invitee, who joins as an admin | Low | High | One use, 7 days, and only for an account with the invited email; the page says to share it only with that person; open invites are listed and can be cancelled; the admins list shows who joined, and the join is audited (D-39) |
| R-33 | Pairing writes Supabase Auth's own tables (`auth.users`, `auth.identities`) from a database function, so a change in Supabase Auth's schema could break pairing | Low | Med | e2e pairs a board on every pull request's preview against the real project, so a break shows before merge; the demo sign-ins depend on the same shape (D-39, D-40) |
| R-34 | Someone floods wrong pairing codes and pauses pairing for every household | Low | Low | Pairing resumes 10 minutes after the flood stops; paired boards are unaffected; the pause is what makes guessing a code hopeless (D-40) |
| R-35 | The repository is public, so a run page or an artifact shows a secret or a one-time code | Med | Med | Seen once (Oct 9): four failure reports from before D-48 held the deployment-protection bypass in their traces, and two setup-code run pages showed codes. Now: e2e uploads no report while public, setup-code issues no code while public, backups are never artifacts; the owner rotates the bypass secret and deletes those runs and artifacts (Y-10). |
| R-30 | A deploy stops because the one database holds a migration that `main` lacks (an open pull request's, applied at its preview), as PR #5's did while PR #6 was open | Med | Med | Migrations run through `scripts/db-migrate.sh`, which applies the commit's pending migrations and reports the others instead of refusing (`supabase db push` refuses); tested in `ci / database` |

### Spikes (time-boxed, before dependent work)

| ID | Question | Unblocks |
|---|---|---|
| SPIKE-01 | Do device-as-Supabase-Auth-user sessions stay valid for months on a kiosk, and do Realtime + RLS behave with the `device_household_id()` check? **Answered (WP-05):** refresh tokens do not expire on Free, but reuse detection can revoke a session, so the board keeps a credential and signs itself in again; Realtime honours RLS and stops at disconnect (`01` §5.1). | DEV-01, DEV-02, DEV-05 |
| SPIKE-02 | Does a published iCloud ICS link give correct recurrence/DST/all-day results through `ical.js`? Does a secondary read-only Apple ID work with CalDAV? | CAL-01, CAL-07, CAL-08 |
| SPIKE-03 | On the real 4K 32" panel and Pi 5: touch latency, calibration, Chromium kiosk flags, screen power control, and **4K animation frame rate** (celebrations, scrolling) at 1920×1080 logical / DPR 2 versus a 1080p fallback | DEV-04, DEV-07, NFR-02, NFR-03 |
| SPIKE-04 | Which platform does the school's menu use, and is there a stable machine-readable feed? **Answered:** Nutrislice, public JSON API (`01` §5.5). | MENU-02 |
| SPIKE-05 | Do `pg_cron`/`pg_net` → Vercel job calls fit within function time limits for the sync workload? | CAL-02, CHR-03 |

### Assumptions

| ID | Assumption |
|---|---|
| A-01 | One household in v1; schema is multi-tenant-ready. |
| A-02 | Admins use Apple devices; magic link and email + password are the required sign-in methods (Sign in with Apple and passkeys are additive, ACC-06). |
| A-03 | Child can navigate icon-first UI; text is secondary. |
| A-04 | US English, imperial units, Monday–Friday school week. |
| A-05 | Home wifi is generally stable; outages are short. |
| A-06 | The panel is mounted at child-reachable height or on a stand. |
| A-07 | Apple Calendar remains the household's event system of record. |
| A-08 | Production stays dark until launch; there is no staging environment and no Docker in the workflow. |
| A-09 | Free plans only: Supabase Free (one project), Vercel Hobby, GitHub Free. |
| A-10 | Family members trust each other at the board: anyone can check off any family-visible item, and each check-off records who did it and that it came from the board. |
| A-11 | Parents use iPhones on iOS 16.4 or later and add the admin app to the Home Screen, which web push requires. |
| A-12 | Only the owner and Claude Code (acting for the owner) push to the repository. It is public since D-48, so it holds no secrets and run pages hold none either (R-35). |

---

## H. Maintaining traceability

0. Claude Code maintains `01`–`05`. Every PR that changes behavior, schema, scope or sequence updates the affected artifact and adds a row to **I**.
1. New requirement → add to **A**, add a matrix row in **B**, write at least one story (`03`) and at least one work package (`05`) with `Reqs:`; run `--fix` to fill the Stories and Work packages columns.
2. Run `python check_traceability.py --docs . --tests .` locally and in CI.
3. Never rename an ID; deprecate with a note and add a new one.
4. In code review, link PRs to requirement IDs; in commit messages, prefix with `[ID]`.

---

## I. Change log

| Version | Changes |
|---|---|
| 0.8.62 | WP-45 weather on the board (D-69), in review (PR #45): the household sets its place once on Home (a town's name through Open-Meteo's geocoding, chosen from what matches, or a US ZIP code through Zippopotam.us; kept to two decimals) and °F or °C; the `weather` job reads the temperature now and today's high and low from Open-Meteo every 30 minutes, and a change on Home reads at once; the board shows the sky, the temperature and today's high beside the clock, credited to Open-Meteo, from its snapshot only. A failed read hides the weather and nothing else changes; Home says why. A layout can turn it off. Traced by pgTAP (`290_weather`, 37: the place kept to two decimals, °F or °C, who may set and store, a read stored and one for an old place or unit dropped, a failure marked with the last good values kept, the snapshot showing a read only while it worked and is recent, RLS, the layout's switch and live updates), unit tests (`lib/weather`: the request, reading the answer, failures, storing, finding places by name or ZIP; `lib/sky`; `lib/board-layout`; `lib/board`), the UI suite (`weather.spec`: the weather beside the clock at 1920×1080 in Day and Evening, 28 px text and contrast, none without a reading or with the layout off or yesterday's, nothing else moving; Weather on the boards on a phone and a laptop) and e2e on the preview (`weather.spec`: the done-when, with the job's own code reading made-up weather on the runner, and Home's unit switch and Stop). |
| 0.8.61 | WP-35 done (PR #44): approved by the owner and merged once CI and e2e were green on the preview (108 passed, no retries, on `7625152`; the done-when: a card moved up on Boards reached the board 806 ms after the press, against 3 s, and 908 ms on the first run). The first run's only retry was `offline.spec`: the three offline check-offs reached the database early although a route blocked them, so the spec now cuts the board's network with a local proxy (D-64). The screenshots for the owner's preview showed a long word ("Grandparents") running past its event in five and seven days; titles now break inside their event, seven days use the board's smallest text, and the UI suite checks that no title runs past its event (`a4d2de1`). WP-45 is ready. |
| 0.8.60 | WP-35 family dashboard and board layout (D-66, D-67), in review (PR #44): the board's home screen is a family dashboard (the calendar: 3, 5 or 7 days, or the month with a dot per calendar, a day opening as a day; today's list beside it, a row per item with a face for each person it is for; then goals, waiting for a parent and coming up, in the layout's order), and its layout is the household's or a board's own, set on Boards. BRD-07's Family view is the dashboard's list (a column per person is the Chores screen); every tile is one height, with "More info". Traced by pgTAP (`280_board_layout`, 27: the layout's shape where it is stored, saving the household's and a board's own and only by its household's admins, what each board reads, the items' descriptions and the three-week window), unit tests (`lib/board-layout`, `lib/dashboard`, `lib/board`), the UI suite (`dashboard.spec`: the dashboard at 1920×1080 in Day and Evening, 56 px targets, 28 px text, contrast; the month's dots and a day opening; faces checking off and undoing; "More info"; tiles one height; Chores) and e2e on the preview (`board-layout.spec`: the done-when, reordering cards on Boards reaching a paired board within 3 seconds, and a board's own layout). BRD-04 (weather) moves to WP-45. Also: `offline.spec` cuts the board's network below the browser while offline (a local proxy, `e2e/support/network.ts`), as the route it used let the three check-offs out early once on the first preview run (D-64 updated). |
| 0.8.59 | WP-23 done (PR #43): approved by the owner and merged once CI and e2e were green on the preview (105 passed, no retries; the done-when: School's events left the board 829 ms after Save, against 3 s). The first run's only failure was the e2e's own check of School's color: it compared the board's computed `--cal` with the text `var(--member-3)`, but a custom property's computed value comes with `var()` resolved (`#c2410c`); it now compares it with `--member-3` on the same event. WP-35 is ready. |
| 0.8.58 | WP-23 calendar views and per-board selection (D-65), in review: the board's Calendar beside the people (Week by default, Day and Month; arrows, a swipe or Today; three a day in a month and "+N more", a day opening as Day), each event in its calendar's color with the avatar of whose calendar it is, a calendar behind saying so; a person's screen lists today's events from their calendars and the family's. Each board follows the calendars' "show on the boards" until an admin saves its own choice on Boards (`device_calendar`, `set_board_calendars()`); a calendar connected later stays off a board with its own choice. The snapshot carries the calendar over its window and `board_calendar()` reads other ranges; RLS shows a board only its calendars' events. Traced by pgTAP (`270_board_calendars`, 31: defaults, a board's own choice, another board unaffected, a calendar connected later, reselecting keeps color and person, only changes written, who may choose, the defaults changing, removal; `070` gains the two Realtime tables), unit tests (`lib/board-calendar`: weeks from the household's first day, months as whole weeks, steps, titles, a day's events, times past midnight, a calendar behind, reading the slice), the UI suite (`board-calendar.spec.ts` on `/dev/board`: 56 px and 28 px at 1920×1080 in both themes, the week's colors and avatars, arrows, swipe and Today, 40 events in a month, a calendar behind, offline, a person's events) and e2e on the preview at 3840×2160 (`board-calendar.spec.ts`: the done-when, unticking a calendar takes its events off the board within 3 seconds; ticked again in its color; a calendar connected later stays off). |
| 0.8.57 | Change to WP-13 (D-64), done (PR #42): approved by the owner and merged once CI and e2e were green on the preview (101 passed, no retries, `offline.spec` included: its check-offs stayed on the board while offline and arrived exactly once when it came back). The admin-rename-to-board timing in the same run: p50 897 ms, p95 1097 ms, max 1357 ms. |
| 0.8.56 | Change to WP-13 (D-64), in review (PR #42): the board's outbox sends nothing while the browser says it is offline, and sends at once when it says it is back; a missed `online` event is caught by the next retry. Unit tests (`lib/outbox`: a day of retries offline posts nothing and the board waits, then one send in order on `online`; back online without the event, the next retry sends) and the UI suite's offline, Today and shop specs. The first preview run still saw `offline.spec`'s check-offs arrive once "while offline": Playwright's offline mode can attach to a reloaded page a moment after the board's first scripts, so the board read itself online and the request went out. `offline.spec` now also blocks the board's check-offs at the browser context while offline (checked locally: it holds for a page its service worker controls, right after a reload). |
| 0.8.55 | WP-22 done (PR #41): approved by the owner and merged once CI and e2e were green on the preview (101 passed, no retries). The first run's only failure was `calendar.spec.ts`'s own check that the link is in no row or audit entry: it searched the whole audit log for `familywise.invalid`, which the demo sign-ins' addresses also end in, and now searches for the link's own path. That run had already shown Vault working for the migration's owner in production (the link saved and read back). WP-23 and WP-29 are ready (SPIKE-02's CalDAV part comes first in WP-29). |
| 0.8.54 | WP-22 ICS calendar sync (D-63), in review: calendars connected by their public link on Calendars, the link only in Vault and never shown again; saving a link syncs it at once; the `calendar_sync` job every 15 minutes syncs each household's calendars due, expanding a week back to 120 days ahead in the household's zone and skipping a file unchanged that day; a broken link keeps its last good events and says what to do, on Calendars and on System Health; titles, times and all-day only, no places. Traced by pgTAP (`260_calendar_sync`, 56: the link in Vault only and read back only by the job; calendars changed only through their functions; a sync's instances on their household-local days; the series' time across the clock change; the moved instance's own event; a skip; a failure keeping the last good events; a refused sync changing nothing; the link replaced in place; removal, and a household's removal, taking the link), unit tests (`lib/calendar`: the window; DST; moved, far-moved, deleted and cancelled instances; a monthly rule; all-day events; UTC; no personal fields kept; a skip and a new day; each failure's words; the job's run. `lib/calendars`: the form, the status words, event times), the UI suite (`calendars.spec.ts` on `/dev/calendars`, phone and laptop in both themes) and e2e on the preview (`calendar.spec.ts`: Alex adds a calendar and the link is only in Vault; the job's own code on the runner against a made-up calendar built around today; a broken link on Calendars and System Health; OK again; removal). SPIKE-02's expansion stopped a series at an instance moved past the window; it now goes by the series' own times. |
| 0.8.53 | e2e reliability, done (PR #40): approved by the owner and merged once CI and e2e were green on the preview. every spec that paired a board left it live for the rest of the run, and since WP-20 any of them could take a goal's celebration (`board-shop.spec` failed with the goal celebrated by another board) or replay a queued check-off. Each spec now retires its board (`e2e/support/board.ts`). `wishlist.spec` reads the bonus ledger once the server action has answered, before what the page says (a second payment and a page still showing the first tap's words look alike; it had failed twice that way), and archives a rule left by a failed attempt. Board-pairing setups get 90 s. `offline.spec` and `board-shop.spec` say on failure who sent what and which boards are paired; the school archive test is marked slow. No test is skipped or loosened. |
| 0.8.52 | Fix (D-62), done (PR #39): approved by the owner and merged once CI and e2e were green on the preview (92 passed, no retries). Production's jobs leave the demo family alone. Previews share the production database as the demo family (D-37), and `goals.spec` found a goal reached once before it began, most likely production's goal reconcile catching a check-off an earlier step was about to take back. `household.is_demo` marks the demo family (the seed and the migration set it; only the server, the seed or a migration changes it), the job endpoint lists every household but it, and System Health says so for the demo family. pgTAP `250_demo_household` (10) and `012`, a unit test of the job store, and `health.spec` on the preview. The first e2e run after the deploy is the proof that no job reaches the demo family. |
| 0.8.51 | Fix (D-61), done (PR #38): approved by the owner and merged once CI and e2e were green on the preview (96 passed, no retries; the first run after D-62 was deployed). A parent links their own sign-in to themselves in one tap. For a sign-in linked to no one, Reminders and My tasks ask "Which one is you?" among the adults still here with no sign-in; an adult's page on Members offers "This is me" when the parent's sign-in is on no one or on an archived record. `link_my_member()` links only the caller's own sign-in, only to an adult of their household who is not archived and has no one else's, and moves it from wherever it was. A Child record says only an adult can have a sign-in; the sign-in choice names one already linked to someone else. Found by the owner on Oct 10: their own record said Child, which hides the sign-in choice. pgTAP `240_link_my_member` (17), unit, UI suite and the preview's `link-me.spec.ts`. |
| 0.8.50 | WP-20 done (PR #37): approved by the owner and merged once every gate was green on the merge with main (WP-40), e2e green on the preview, the done-when at 3840×2160 included (the first run's only failure was `wishlist.spec.ts` expecting the wish card's old words, fixed in the test). WP-31 is ready. WP-44 added (D-60): goal progress projected on the board only while it is offline, as a fallback; ready, and nothing waits on it. RWD-07 and NFR-01 trace to it. |
| 0.8.49 | WP-20 the board's shop, requests and goals (D-59), in review (PR #37): the snapshot's `available`, `requests`, `limited`, the shop's `left` and `photo`, and `goals` with each rule's progress; `mark_goal_celebrated()` and `POST /api/goals/celebrated`; the shop, requests and goals in Realtime; the shop dialog ("Ask for this", "Yes, ask"), the "Asked for" card (call off while waiting), "Ask for it" on the wish card, goal meters, nudges, family goals under everyone's day, and a once-only celebration (still with reduced motion). pgTAP `230_board_shop_goals` (37), unit, UI suite and the preview's `board-shop.spec.ts` at 3840×2160. |
| 0.8.48 | WP-40 done (PR #36): approved by the owner and merged once every gate was green on the merge with main (WP-19, WP-30), e2e green on the preview, the reminders job's done-when included. Earlier preview runs failed only on test locators: the bell's value (fixed in the code: a form action's button loses its name, so the value is bound into the action), and a label search for "Due time" matching first the editor's help (reworded) and then the new "At the due time" choice (fixed in the test). Nothing waits on it. Owner action: run the vapid-keys workflow once, then send a test from the iPhone's Home Screen app. |
| 0.8.47 | WP-40 reminders (D-58), in review: each person's own `reminder_preference`, `push_subscription` and `reminder_delivery` (RLS); the `reminders` job every 5 minutes (`plan_reminders()`, `claim_reminders()`, web push with VAPID, `finish_reminder()`), each reminder at most once, never after its item is done, held through quiet hours; the Reminders page, the bell in My tasks, an item's lead time; push handling in the service worker; the vapid-keys workflow. Traced by pgTAP (`220_reminders`: who sees and changes what, the due time less the lead, the morning time, the digest, a replay, done first and done after planning, off for the person, the item and the device, quiet hours held and released once, a private title hidden, 410 deleting a device, pruning), unit tests (`lib/reminders`: VAPID and encryption read back as the browser would, a run sending to each device and recording answers, no keys; `lib/reminder-settings`; the item editor's lead time), the UI suite (`reminders.spec.ts` on `/dev/reminders` and the bell on `/dev/admin?view=my`, phone and laptop in both themes) and e2e: on the runner against a mocked push service (`reminders-job.spec.ts`: one push for a task due in 15 minutes, none after completing it first, none when switched off for the item, the device or the person, quiet hours released once, a private title absent from the decrypted message) and on the preview (`reminders.spec.ts`: settings saved, a device switched, tested and removed, the bell, the lead time). |
| 0.8.46 | WP-30 done (PR #35): approved by the owner and merged once every gate was green, after main (WP-19) was merged in and the docs stacked; e2e green on the preview (the first run's only failures were the test reading the archived bonuses before opening their closed disclosure, and its expected "saved" figure not counting a balance below zero as none, as the card does; both fixed in the test). Nothing waits on it. |
| 0.8.45 | WP-30 bonus rules and the wishlist (D-57), in review: `points_rule` (a streak of 2 to 365 good days, or a perfect day; 1 to 1,000 points; counting from a date; on, off or archived) applied by day close to the stored history through `apply_points_rules()`, each bonus posted once through the ledger's one writer (`rule:{rule}:{member}:{run or day}`); a parent's "Pay bonuses now" rebuilds stale history first; `wishlist_pin` and `pin_wish()`; `POST /api/wishes`; the snapshot's `shop` and each earner's `wish`; the board's wish card (a meter, "N more points to go", "You have enough! Ask a grown-up for it.") and picker. Traced by pgTAP (`210_bonus_rules_wishlist`: a 7-day run pays one bonus to the earner only, a rerun and a longer run pay nothing, counts-from and run length, perfect days once each, a paused or archived rule, who may set and apply, pins as a board and a parent, the snapshot's wish and shop), unit tests (`lib/bonus`, `lib/wishes`, the snapshot reader, day close calling the rules), the UI suite (`today.spec.ts` on `/dev/board`: the meter, choosing, enough, no wish, cancel, offline, the picker's fit and contrast in both themes; `rewards.spec.ts` on `/dev/rewards`: the bonus list and form, who is saving for what) and e2e on the preview (`wishlist.spec.ts`: a 3-day bonus pays Leo once for his seeded run, paying again pays nothing, off, on from today and archived; Leo chooses and drops a wish on a paired board; the API's refusals). |
| 0.8.44 | WP-19 done (PR #34): approved by the owner and merged once every gate was green, e2e green on the preview (the first run's only failure was a test locator matching the icon picker's "target" icon, fixed in the test). WP-20 and WP-39 are ready. |
| 0.8.43 | WP-19 goals and the progress pipeline (D-56), in review (PR #34): `reward_goal`, `reward_rule`, their derived progress and the event log; goals set, changed, redeemed and cancelled by a parent (`save_goal()` and friends, checked and audited); dirty marks on every change a goal may count; the engine evaluating goals in `progress_reconcile` (every 5 minutes), after a check-off in production, and on the Goals page; each status change applied once, refused when the read is stale; reversible achievement (n + 1 on meeting it again). Traced by pgTAP (`200_goals`, 52), unit tests (`lib/goals.test.ts`, `lib/jobs/goals.test.ts`), the UI suite (`e2e/ui/goals.spec.ts`) and e2e on the preview (`goals.spec.ts`: the seeded goal achieved, unachieved by an uncheck and achieved again; a spoiled, dirty goal healed). |
| 0.8.42 | WP-17 done (PR #33): approved by the owner and merged once every gate was green, e2e green on the preview with WP-12's, WP-18's and WP-13's specs alongside. Flame milestones stay at 3, 7, 14 and 30 days; the confetti half of the milestone celebration goes with WP-20. WP-30 is ready. |
| 0.8.41 | WP-17 streak history and insights (D-55), in review (PR #33): `member_daily_summary` and `streak_segment` stored through yesterday from the rules engine by day close (members marked when their occurrences change) and by the Insights page for a stale member; `member_insights()`; the board's streak flame. Traced by pgTAP (`190_streak_history`: 14 days of a child's routines with misses, skips, a covered day, an uncheck, approvals and a send-back; the facts, the hand-computed history saved and rebuilt identically, marks, the insights, who may, the board's slice), unit tests (`lib/history`: the same 14 days through the engine match the table; `lib/jobs/history`: day close rebuilds marked members; `lib/streak`: today's class and the flame), the UI suite (`insights.spec.ts` on `/dev/insights`, phone and laptop in both themes; `streak.spec.ts` on `/dev/board`: the flame, the 7-day glow, reduced motion) and e2e on the preview (`insights.spec.ts`: Leo's seeded week as hand-computed, a rebuild leaving every row identical, Maya's flame on a paired board). |
| 0.8.40 | WP-13 done (PR #32): approved by the owner and merged once every gate was green, e2e green on the preview with WP-12's and WP-18's specs alongside. The owner accepted D-54 (our own service worker rather than Serwist); the real 24-hour soak on the Pi stays with WP-24. Nothing waits on WP-13. |
| 0.8.39 | WP-13 the board through an outage (D-54), in review (PR #32): the outbox, last snapshot and check-offs ahead of it in IndexedDB (Dexie) for the paired board; the service worker keeps the board's page (used only with no network) and the build files it loads; "Offline: your check-offs are saved", "Updated 12 minutes ago" and "Today's list may be out of date" in the bar; provisional points while offline. Traced by unit tests (`lib/outbox` with a store, `lib/board-store` on fake-indexeddb, `lib/board-health`), pgTAP (`180_board_job_health`: a board reads its own household's job health, not another's), the UI suite on `/dev/board` (`offline.spec.ts`: three check-offs offline through a reload served by the worker, sent once each on reconnect; a day offline with every timer run; the lines in both themes, AA contrast, no second live region) and e2e on the preview (`offline.spec.ts`: exactly three events after a reload offline, a parent's later uncheck winning, the board opened after a day offline). NFR-01's real 24-hour soak is on the Pi (WP-24, HW). |
| 0.8.38 | WP-18 done (PR #31): approved by the owner and merged once every gate was green, e2e green on the preview with WP-12's specs alongside. WP-39 and WP-20 wait on WP-19 too. |
| 0.8.37 | WP-18 the rewards shop (D-53), in review (PR #31): `reward_catalog_item` and `redemption`; requests within the available balance, stock and weekly limit under locks; a parent approves (one spend), says not this time, marks given or cancels (refunding); photos in a private Storage bucket per household; `POST /api/redemptions` and `/api/redemptions/cancel`; the Rewards page. Traced by pgTAP (`170_rewards`: the shop's rules, each decision, refunds, who may, RLS, photos' folders; `012` for the demo shop), `scripts/redemption-race.sh` (two requests at once, real sessions; removing the locks fails it), unit tests (`lib/rewards`), the UI suite on `/dev/rewards` and e2e on the preview (`rewards.spec.ts`: a reward with a photo, a board's requests, approve and give, cancel and refund, not this time, photo removed). |
| 0.8.36 | WP-12 done (PR #30): approved by the owner and merged once every gate was green, e2e green on the preview. A sent-back check-off keeps its approval flag (D-22 names `scheduled` only); extending the re-resolve to it stays an open question for the owner. WP-40 is ready. |
| 0.8.35 | WP-12 a parent's day (D-52), in review (PR #30): the admin Today page (check-offs waiting for a parent, any day for late credit or skipping, "Not actually done" as one batch with Undo), the approval switch on Home, and My tasks with quick add. `undo_uncheck_batch()` puts a batch back. Traced by pgTAP (`160_admin_operations`: one batch id, four reversals once, the board's view, putting back once and only where unchanged, who may, the approval switches re-resolving an unchecked item while one waiting keeps its flag), unit tests (`lib/admin-day`), the UI suite on `/dev/admin` (`admin-day.spec.ts`: layout on a phone and a laptop in both themes, words and buttons per state, who did it, My tasks) and e2e on the preview (`admin-day.spec.ts`: four of five unchecked in one action with the board and the ledger, Undo, late credit, skip, approval on with approve and send back, quick add reaching the board). |
| 0.8.34 | WP-15 done (PR #29): approved by the owner and merged once every gate was green, e2e green on the preview. WP-17 and WP-19 are ready. |
| 0.8.33 | WP-15 rules engine (D-51), in review (PR #29): `evaluateGoal` (COUNT, POINTS, DAILY_ALL_DONE, STREAK with grace per household week; all or any; the status changes an evaluation calls for) and `evaluateHistory` (daily summaries and raw good and bad runs), pure and deterministic. Today counts as good once it qualifies and is never bad. Traced by Vitest: a named test for each edge case in `02` §5 (`goal.test.ts`, `history.test.ts`, `dates.test.ts`) and nine fast-check properties (`properties.test.ts`); 100% of lines, 96.7% of branches; seventeen deliberate breaks each caught. |
| 0.8.32 | WP-11 done (PR #28): approved by the owner and merged once every gate was green, e2e 57 of 57 on the preview. The owner confirmed D-50: the board never shows why points were taken away. WP-12, WP-13 and WP-18 are ready; WP-12 and WP-18 were ready from WP-16's merge but not marked so. |
| 0.8.31 | WP-11 board Today and check-off (D-50), in review (PR #28): the board opens on everyone's day, a column each, and shows a person's own day with their points; a tap checks off at once through an in-memory outbox with ids made on the board; a shared item asks who did it; undo is its own button with a second tap; a child's check-off celebrates (reduced motion honoured); points a parent took away read "A parent changed your points". The snapshot carries today's items, open overdue tasks and the undo window; `chore_occurrence` and `chore` are in Realtime. A-12 now matches D-48. Traced by pgTAP (`150_board_today`, and `070` for the snapshot), unit tests (`lib/today`, `lib/outbox`, the snapshot reader, `ChoreTile`), the UI suite on `/dev/board` (`e2e/ui/today.spec.ts`: click, touch, keyboard, double tap, undo, picker, celebration, reduced motion, sizes and contrast in both themes) and e2e on the preview (`board.spec.ts`). |
| 0.8.30 | WP-16 done (PR #27): approved by the owner and merged once every gate was green, e2e 51 of 51 on the preview. WP-11 is ready. |
| 0.8.29 | WP-16 points ledger (D-49), in review (PR #27): `points_ledger` is append-only and written only by database functions; earns and reversals reconcile each occurrence's points with its status for exactly those it rewards; a parent adds or takes away points with a reason on the member's page; each rewarded member's balance and five latest entries are on the board's snapshot and in Realtime; the nightly status check also covers points. Traced by pgTAP (`140_points_ledger`: each story's criteria, adjustments, append-only, RLS, the snapshot, the backfill, the drift check, and a property test over 300 random steps against an independent balance; `012` for the demo family), unit tests (`lib/points`, the snapshot reader, `status_check`) and e2e (`points.spec.ts`, and the board's check-off in `devices.spec.ts`). |
| 0.8.28 | WP-43 done (PR #25): approved by the owner and merged once every gate was green on the head carrying main, e2e included. Y-10 now lists all four public failure reports from before D-48. |
| 0.8.27 | The repository is public (D-48, R-35): Actions is free there. e2e keeps no Playwright report and runs only this repository's own commits; setup-code issues no code while public; Vercel's fork protection is on. Owner action Y-10. |
| 0.8.26 | WP-43 everyone does their own (D-47), in review (PR #25): new CHR-18 and US-320. An item with several people is either each person's own (one occurrence per person per day, with that person's day type, credit and miss) or shared (D-30). New chores start as each, new tasks as shared; items saved before stay shared. Traced by pgTAP (`130_each_person`, and the random-edit property in `110_occurrences` now switches modes), unit tests (`lib/chores`) and e2e (`chores.spec.ts`). |
| 0.8.25 | WP-10 done (PR #23): merged with every PR gate green and e2e 46 of 46 on the preview; completion events, day close and the nightly status check are live in production. |
| 0.8.24 | WP-10 completion events (D-46), in review (PR #23): every check-off, undo, approval, rejection, skip and correction is an append-only event, recorded as the caller (board, admin or system) under RLS through `POST /api/completions`, each event in a batch answered on its own. The status is folded by event time into the occurrence; day close (hourly) finalizes routines, which become missed when not done, while tasks carry over; a nightly check fails on any drift. Traced by pgTAP (`120_completion_events`: immutability, replay, event-time order, the clamp, the flag, approval, day close, rebuild, a property test over 200 random events against an independent fold, RLS), unit tests (`lib/completions`, the jobs, `historyLine`) and e2e (a paired board's check-off, replay and undo in `devices.spec.ts`; an item's last week in `chores.spec.ts`). The migration runner's additive check ignores grants and revokes. |
| 0.8.23 | WP-09 done (PR #22): merged with every PR gate green and e2e 43 of 43 on the preview; occurrences are live in production. |
| 0.8.22 | WP-09 occurrences (D-45), in review (PR #22): every item is planned for today and the next 14 days by the database, one shared occurrence per due date with a snapshot of who was responsible and each one's day type. The hourly `occurrence_gen` job (minute 23) fills the window; edits re-plan at once by trigger. Only occurrences nothing has happened to change, never a past one: an item's own edit reaches today's in place, keeping its id; a school-year change starts tomorrow (D-24). CHR-03 reworded to match. Traced by pgTAP (`110_occurrences`: schedules, idempotent generation, a property test over 40 random edits, D-24 closures, DST, the per-member view, RLS), unit tests (`lib/chores`, the job schedule) and e2e (`chores.spec.ts`, `school.spec.ts`). |
| 0.8.21 | WP-21 done (PR #21): merged with every PR gate green and e2e 41 of 41 on the preview; school years are live in production. |
| 0.8.20 | WP-21 school years (D-44), in review: school years, terms, breaks and days off, with each member following their own school year or the default for that date; default years may not overlap, so next year's calendar starts on its own. `resolve_day_type` is traced by pgTAP (`100_school_year`: weekend, break, no_school, school_day and summer precedence; a school-days-only item applies on no day of a break week), unit tests (`lib/school`) and e2e (`school.spec.ts`). Regenerating future occurrences when a closure changes (D-24) moves to WP-09, which brings occurrences. |
| 0.8.19 | WP-08 done (PR #19): merged with every PR gate green and e2e 36 of 36 on the preview; the family list is live in production. |
| 0.8.18 | WP-08 the family list (D-43): chores and tasks for any member with several assignees, schedules checked by zod and by the database, optional due times grouped into Morning, After school, Evening and Anytime, household tags by id, and private items that the board and the other admin never receive, down to their audit rows. Only an item's creator changes who sees it. Traced by pgTAP (`090_chores`), unit tests (`lib/chores`, `lib/tags`) and e2e (`chores.spec.ts`, which also times entering six chores and two tasks on a phone screen). |
| 0.8.17 | P0 done: WP-42 merged (PR #17) and every P0 exit criterion passes: all PR gates green; pgTAP isolation and revoked-device tests green; on a preview an admin signs in by password, starts a household with a setup code, adds a child, pairs a browser as a board and sees a rename in 0.84 s (p95); the production deploy pipeline is green. Next is P1a. |
| 0.8.16 | WP-42 System Health (D-42): `/admin/health` shows the household's background jobs, its server errors from the last 30 days, and usage against the Free-plan limits with a warning at 80 %. Errors are kept with their household and read through admin-checked functions, so previews show the page and no household sees another's. The usage workflow reads the Vercel account's usage daily; the account total and FamilyWise's share are shown. NFR-07 and NFR-08 trace to `private.usage_sample`, and NFR-08 is tested by unit, pgTAP and e2e tests. |
| 0.8.15 | SPIKE-02 (ICS part) done: iCloud serves the whole history with an ETag but ignores conditional requests, so the sync compares the ETag itself; zones, rules (BYDAY ordinals, BYSETPOS), moved instances and all-day events expand correctly with ical.js, and local times hold across the clock change. WP-22 is queued; the CalDAV part runs before WP-29. CAL-07's unit tests start here. |
| 0.8.14 | Y-6 done: an iCloud calendar is published (a real family calendar, so SPIKE-02 reports counts and checks only), so SPIKE-02's ICS part is ready; its CalDAV part runs before WP-29. Y-8 (production domain, Apple Developer Program) is not needed before P3: only WP-38 and custom email wait on it. |
| 0.8.13 | WP-06 merged (PR #12) and deployed: the board's snapshot and live updates run in production. Y-9 done: Supabase Auth points at production and its own sign-up is off; L-12 stays the end-to-end launch check. PR #13: the setup-code run's summary page shows the code again (a GitHub mask had hidden it there too) and links to production's `/setup`. |
| 0.8.12 | WP-06 board shell (D-41): `public.board_snapshot` is the board's one read (members for now; null for anyone but an active board, and at once on disconnect). The server draws the first snapshot and the board keeps it live itself: Realtime on every board-readable table, then a coalesced read straight from Supabase, and a catch-up read on every (re)connect and when the network returns. DEV-05's p95 under 3 s is measured by e2e on every pull request (20 admin renames). An admin can hold a board on Day or Evening. DEV-05 traces to `board_snapshot` and is tested by unit, pgTAP and e2e tests. |
| 0.8.11 | WP-05 boards and SPIKE-01 (D-40): an admin names a board and gets an 8-digit code (one use, 10 minutes); `redeem_pairing_code` creates the board's own Supabase sign-in in the database, so previews pair exactly as production does; wrong codes are counted and 20 in 10 minutes pause pairing. The board keeps its credential in an httpOnly cookie and signs itself in again when its session lapses. Disconnecting is final: RLS stops reads at once and the sign-in is banned; status changes only through `revoke_device`. `/board` shows the paired board's family, live through Realtime under RLS; boards get 403 from `/admin`. SPIKE-01 answered (`01` §5.1). R-03 reframed; R-33, R-34. WP-04 done (PR #10). |
| 0.8.10 | WP-04 members (PR #10): the members page adds, edits, archives and restores children and adults with avatar, color and the earns-rewards switch (on for a child and off for an adult to start, changeable for anyone). An adult member links to an admin's sign-in; a database trigger refuses any other link, since later work reads "who am I" from it, and unlinks the member when its admin leaves. A link styled as a button took the admin link color (1.38:1, caught by the axe check on the preview); links now leave buttons alone, and the brand page carries one so `ci / build` catches it. WP-03 done (PR #9). |
| 0.8.9 | WP-03 admin sign-in and onboarding (D-39): no public sign-up. A setup code from the new setup-code workflow creates a household and its owner; invite links (token after `#`, one use, 7 days, the invited email only) add admins; the server creates accounts confirmed, so nothing depends on Supabase's built-in mailer. Password sign-in, magic links for existing accounts and password reset; sessions verified on the server, `proxy.ts` for refresh and redirects. Every household table is audited by trigger (`audit_log`), replacing the planned `withAudit` wrapper. Previews sign in with one tap as four demo parents, with passwords derived from the bypass secret. ACC-02 adds unit tests; the P0 exit checks the magic link in production at launch (L-12), since preview sign-ins cannot receive email. Y-5 is no longer a blocker: the second admin joins with a password. New Y-9 (Supabase Auth settings before launch), R-31, R-32. WP-07 done: the hourly heartbeat runs on its own in production; a forced failure shows `failing` and a replay returns it to `ok`. |
| 0.8.8 | WP-07 job framework (PR #8): schedules as code synced to pg_cron by the deploy; `private.call_job` (off until the job-secret workflow writes Vault); `POST /api/jobs/[job]` answers 202 and works after the response, one `job_run` row per household; `job_health()`; sample hourly `heartbeat`; `purge_history`; job-secret and job-run workflows; structured logs without PII and `private.app_error` via `onRequestError`. The System Health page becomes WP-42 (after WP-03), so it is built once, behind admin sign-in. NFR-07 gains pgTAP, unit and e2e tests. |
| 0.8.7 | PR #5's deploy stopped at migrate: PR #6's preview had applied its migration, `main` did not have it yet, and `supabase db push` refuses then. Migrations now run through `scripts/db-migrate.sh` in the deploy, e2e (`--additive-only`) and the database tests; it reports such migrations and carries on, runs each migration with its history row in one transaction, and refuses files that commit part of themselves. R-30. |
| 0.8.6 | SPIKE-05 measured job calls on Vercel Hobby (`01` §5.6): calls stop at 300 s (504); pg_net starts its next batch only when the current one has finished, so job endpoints answer at once and work after the response; a cold start costs about 0.4 s of CPU and a warm call a few ms; concurrent calls each get an instance, so every schedule has its own minute; cron reports `succeeded` whatever the endpoint answers, so health comes from `job_run`. The job secret is generated by a workflow (WP-07), with no owner step. Jobs are budgeted at under 10 % of each Hobby allowance. D-38, R-28, R-29, L-11; `01` §9.4 corrected (the test bootstrap has no Vault, pg_cron or pg_net stand-ins). |
| 0.8.5 | WP-41 done: PR #4's merge deployed on its own (gate, migrate, app, smoke), and the deploy gate's refusals are tested in `ci / checks` (`scripts/deploy-gate.sh`). Owner setup Y-1 to Y-4 are done or dropped and leave `05` §0 for a Done table. R-26 mitigation. |
| 0.8.4 | First production deploy: gate, migrate, app and smoke passed on `main` (production serves the build, dark until launch); keepalive wrote its first heartbeat. Pull requests open automatically when a work package is built and tested (owner's standing instruction). |
| 0.8.3 | WP-37 merged (PR #3); owner setup Y-4 done. The first production deploy passed the gate and the migrate step, then stopped because the deploy token could not open the Vercel project; the gate now checks the token before the database is touched. |
| 0.8.2 | WP-37 brand system: Evening `--success` is Leaf 400 (8.33:1 on the Evening surface; Leaf 600 was 2.89:1); `.theme-day` and `.theme-evening` force a theme on part of a page; brand checks join `ci / build`. NFR-13 now has tests. |
| 0.8.1 | Owner setup Y-3 done: GitHub repository secrets and variables are in place, so the e2e workflow runs live on previews. |
| 0.8 | One database (D-37): previews use the production project and run as the demo family, a separate household kept apart by RLS; previews hold only the browser-safe key; a PR's additive migrations are applied when its preview is tested, anything that removes or renames ships with the deploy; nothing wipes the database. The delivery loop includes the owner's preview and approval (NFR-14 reworded, US-911). The second Supabase project, `PREVIEW_DB_URL` and the preview project variables are gone; Y-2 dropped. R-27; R-06, R-16, R-20 and A-09 updated. |
| 0.7.2 | GitHub Free does not enforce branch protection, environment secrets or required reviewers on a private repository (D-36). The deploy workflow now enforces the pull request gates: it ships only the head of `main`, from a merged pull request, with every CI check and e2e green. All GitHub secrets are repository secrets. Y-1 becomes the squash-only merge setting. R-25, R-26, A-12. |
| 0.7.1 | PR #1 merged: WP-01 and WP-02 done. WP-01's live-environment checks (e2e on a preview, first production deploy, keepalive on both projects) move to new WP-41, blocked on owner setup Y-2..Y-4. Y-1 is now branch protection for `main`. |
| 0.7 | Reminders for parents (D-35, OQ-13 answered): web push, off until switched on, switchable per person, device and item; at most once per item, never after done; quiet hours, morning digest, private titles hidden. New CHR-15..CHR-17 (US-317..US-319), component `NOTIFY`, WP-40, L-10, R-24, A-11. |
| 0.6 | One family list (D-30..D-34): chores and tasks for every member in one model; one shared occurrence per due date with `done_by` credit and `covered` for the others; routines get missed, tasks carry over as overdue; optional due time; household tag list driving goals by id; family-visible unless private; earns-rewards switch per member. New CHR-09..CHR-14, BRD-07, PTS-07 (US-311..US-316, US-1006, US-1109); CHR-01, CHR-03, CHR-04, CHR-07, BRD-02, PTS-01, RWD-02, RWD-12 reworded; R-22, R-23, A-10; WP-08, WP-09 and WP-12 grow to L. |
| 0.5.3 | The interactive docs pages adapt to phones, tablets, laptops and monitors (fluid type, touch-sized controls, folding filters, restacking matrices, notch-safe gutters). New CI gate `ci / docs` (`01` §9.3) runs the link check and a layout check on 13 device profiles. |
| 0.5.2 | `05` §0 Waiting on you (Y-1..Y-8). The five build artifacts are also published as interactive pages generated from `01`–`05` by `pnpm docs:build`, which CI runs with `--check` for broken links. |
| 0.5.1 | SPIKE-04 done: Nutrislice public JSON API; WP-27 unblocked. Supabase publishable and secret API keys replace anon and service-role key names. |
| 0.5 | Free plans only (D-29): NFR-08 and NFR-10 reworded; NFR-14 uses a shared preview database rebuilt per e2e run instead of per-PR branches; risks R-06 and R-16 updated, R-19..R-21 added; A-09. |
| 0.4.1 | WP-02: `member.color` stores a brand token key (`member-1`..`member-6`) and `avatar_key` one of the 8 brand avatars; the migration lint is a pgTAP catalog test; `household` is the only table without `household_id`. |
| 0.4 | Decisions D-19..D-28 from the build kickoff. Single launch after P3; milestones replace family-use gates; launch acceptance checklist (§E). ACC-02 is now magic link + password; Sign in with Apple and passkeys move to new ACC-06 (US-106, WP-38); passkey clause removed from NFR-04. New NFR-14 delivery pipeline (US-911, WP-01). Event-time conflict resolution, today-only board, approval switch, rejected → missed, closures spare today. WP-19 split (payouts and preview move to WP-39); missing dependencies fixed; spikes added to the backlog. Docs renamed: `01-technical-architecture.md`, `05-backlog.md`. Risks R-16..R-18. |
| 0.3 | Brand: product name FamilyWise; NFR-13 and WP-37 added; brand and style guide `06` and asset kit `brand/` |
| 0.2.1 | Goal achievement is not sticky: reversals un-achieve goals and reverse payouts (RWD-04); approval workflow is a household on/off switch with per-chore override (CHR-05, now Must); negative balance after a reversal accepted; trust metrics added to insights (RWD-12); nothing is cut from scope |
| 0.2 | Persisted occurrence `status` (CHR-07) with day-close and `missed`; bulk uncheck (CHR-08); streak history and insights (RWD-11/12); goal payouts (RWD-13); per-device calendar selection (CAL-05, now Must); points economy domain PTS-01..06; 4K reference panel (NFR-02, BRD-03, SPIKE-03); self-check with real-life parent verification as default (CHR-05); work packages added (`05`) and a Work packages column in the matrix; phases split P1a–P1d |
| 0.1 | Initial register |

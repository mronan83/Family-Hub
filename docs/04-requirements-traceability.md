# 04 — Requirements and Traceability

> Version 0.7 · Status: build baseline · Maintained by Claude Code
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
| CHR-03 | The system shall materialize one occurrence per item per due date for a rolling window, snapshot its assignees, and regenerate only future occurrences on edit. | M | P1 | Design |
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
| BRD-07 | The board shall show a Family view of today: every member's family-visible items and open overdue tasks, grouped by person and part of day, where anyone can check off an item and pick who did it. | M | P1 | User |
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
| NFR-14 | Every change shall reach production only through a pull request that passes CI gates (lint, typecheck, unit, pgTAP, traceability, build) and e2e on its preview deployment against a preview database rebuilt from the PR's migrations; merging applies migrations before deploying the app. No Docker and no staging environment. | M | P0 | User |

---

## B. Traceability matrix

Stories and Work packages are generated from `03-user-stories.md` and `05-backlog.md` (`Reqs:` lines). Do not hand-edit those two columns; run `check_traceability.py` to detect drift.

| Req | Stories | Work packages | Components | Data entities | Verification |
|---|---|---|---|---|---|
| ACC-01 | US-101 | WP-02, WP-03 | ADM, DB | household, household_settings | DB, E2E |
| ACC-02 | US-102 | WP-03 | ADM, SAUTH | household_user | E2E |
| ACC-03 | US-103 | WP-03 | ADM, API, SAUTH | invite, household_user | E2E, DB |
| ACC-04 | US-104 | WP-04 | ADM, DB | member | E2E, DB |
| ACC-05 | US-105 | WP-03, WP-32 | API, ADM, DB | audit_log | DB, E2E |
| ACC-06 | US-106 | WP-38 | ADM, SAUTH | household_user | E2E |
| DEV-01 | US-201 | WP-05 | ADM, API, AUTH, BRD, SAUTH | device_pairing, device | E2E, DB |
| DEV-02 | US-201, US-202 | WP-05 | AUTH, DB, SAUTH | device | DB |
| DEV-03 | US-202 | WP-05 | ADM, AUTH | device | E2E |
| DEV-04 | US-203 | WP-14 | PI, BRD | — | HW, E2E |
| DEV-05 | US-204 | WP-06 | RT, BRD, DB | all board-readable tables | E2E |
| DEV-06 | US-205 | WP-13 | OUTBOX, BRD, API | chore_completion_event | E2E, U |
| DEV-07 | US-207 | WP-34 | PI, BRD | household_settings | HW |
| DEV-08 | US-206 | WP-13 | BRD, OBS | job_run | E2E |
| CHR-01 | US-301 | WP-08 | ADM, API | chore, chore_assignee | E2E, DB |
| CHR-02 | US-302 | WP-09 | OCCGEN, DB | chore, school_closure | U, INT |
| CHR-03 | US-303, US-308, US-311 | WP-09 | OCCGEN, SCHED, DB | chore_occurrence | INT, DB |
| CHR-04 | US-304, US-305, US-1006 | WP-10, WP-11 | BRD, OUTBOX, API, DB | chore_completion_event, chore_occurrence | E2E, DB |
| CHR-05 | US-306, US-310 | WP-12 | ADM, API | chore_completion_event | E2E |
| CHR-06 | US-307, US-309 | WP-12 | ADM, API | chore_completion_event | E2E |
| CHR-07 | US-307, US-314 | WP-10 | DB, SCHED, BRD, ADM | chore_occurrence, chore_completion_event | DB, INT |
| CHR-08 | US-309 | WP-12 | ADM, API, DB | chore_completion_event, points_ledger | E2E, DB |
| CHR-09 | US-304, US-311, US-316 | WP-08, WP-09, WP-10 | ADM, BRD, API, OCCGEN, DB | chore_assignee, chore_occurrence_assignee, chore_completion_event | DB, E2E |
| CHR-10 | US-312 | WP-08, WP-15, WP-19 | ADM, RULES, DB | tag, chore_tag, reward_rule | DB, U, E2E |
| CHR-11 | US-313 | WP-08, WP-09, WP-11 | ADM, BRD, OCCGEN | chore, chore_occurrence | E2E, U |
| CHR-12 | US-303, US-314 | WP-09, WP-10, WP-11 | OCCGEN, SCHED, DB, BRD | chore_occurrence | DB, INT, E2E |
| CHR-13 | US-315 | WP-08 | ADM, BRD, API, DB | chore, audit_log | DB, E2E |
| CHR-14 | US-316 | WP-12 | ADM | chore_occurrence_assignee | E2E |
| CHR-15 | US-317 | WP-40 | NOTIFY, ADM, DB | push_subscription, reminder_preference | E2E, DB |
| CHR-16 | US-318 | WP-40 | NOTIFY, SCHED, ADM, DB | chore_assignee, reminder_delivery | DB, INT, E2E |
| CHR-17 | US-319 | WP-40 | NOTIFY, ADM | reminder_preference, reminder_delivery | INT, E2E |
| RWD-01 | US-401 | WP-19 | ADM, API | reward_goal | E2E |
| RWD-02 | US-312, US-401 | WP-15 | RULES, DB | reward_rule, tag | U |
| RWD-03 | US-401 | WP-15 | RULES | reward_goal | U |
| RWD-04 | US-406, US-407 | WP-19, WP-39 | RULES, API, SCHED, DB | reward_rule_progress, reward_goal_progress | U, INT, DB |
| RWD-05 | US-402 | WP-15 | RULES | reward_rule | U |
| RWD-06 | US-405 | WP-19 | RULES, SCHED, API | reward_goal, reward_goal_event | U, INT |
| RWD-07 | US-403 | WP-20 | BRD | reward_goal_progress | E2E |
| RWD-08 | US-404 | WP-11, WP-20 | BRD | reward_goal | E2E |
| RWD-09 | US-405 | WP-19 | ADM, API | reward_goal, reward_goal_event | E2E |
| RWD-10 | US-406 | WP-39 | ADM, RULES | reward_goal, reward_rule | U, E2E |
| RWD-11 | US-408 | WP-15, WP-17 | DB, SCHED, RULES | member_daily_summary, streak_segment | U, DB, INT |
| RWD-12 | US-408 | WP-17 | ADM, RULES | member_daily_summary, streak_segment | E2E, U |
| RWD-13 | US-409 | WP-39 | RULES, API, DB | reward_goal, points_ledger, redemption | U, INT |
| CAL-01 | US-501 | WP-22 | ADM, CALSYNC, VAULT | calendar_source | INT, E2E |
| CAL-02 | US-502 | WP-22 | CALSYNC, SCHED | calendar_event, calendar_event_instance | U, INT |
| CAL-03 | US-501 | WP-22 | CALSYNC, ADM, BRD | — | REV |
| CAL-04 | US-503 | WP-23 | BRD | calendar_event_instance | E2E |
| CAL-05 | US-504, US-507 | WP-23 | ADM, BRD, DB | calendar_source, device_calendar | E2E, DB |
| CAL-06 | US-505 | WP-22 | CALSYNC, ADM, OBS | calendar_source, job_run | INT, E2E |
| CAL-07 | US-502 | WP-22 | CALSYNC | calendar_event, calendar_event_instance | U |
| CAL-08 | US-506 | WP-29 | CALSYNC, VAULT | calendar_source | INT |
| SCH-01 | US-601 | WP-21 | ADM, DB | school_year, school_term, school_closure, member_school_profile | E2E, DB |
| SCH-02 | US-602 | WP-21 | DB | resolve_day_type | DB |
| SCH-03 | US-302, US-602 | WP-21 | OCCGEN, DB | chore, chore_occurrence | INT |
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
| BRD-01 | US-303, US-1001 | WP-11 | BRD | board_snapshot | E2E |
| BRD-02 | US-1002 | WP-11 | BRD | member | E2E |
| BRD-03 | US-905 | WP-11 | BRD | — | E2E, HW, REV |
| BRD-04 | US-1003 | WP-35 | BRD, API | household_settings | E2E |
| BRD-05 | US-1004 | WP-35 | ADM, BRD | household_settings | E2E |
| BRD-06 | US-1005 | WP-14 | BRD | — | E2E |
| BRD-07 | US-1006 | WP-11 | BRD, API | chore_occurrence, chore_occurrence_assignee | E2E |
| NFR-01 | US-205 | WP-13 | OUTBOX, BRD | — | E2E |
| NFR-02 | US-905 | WP-14 | BRD, PI | — | HW, E2E |
| NFR-03 | US-905 | WP-11 | BRD | — | HW, E2E |
| NFR-04 | US-102, US-901 | WP-02, WP-03, WP-05 | DB, VAULT, SAUTH, API | all tables | DB, REV |
| NFR-05 | US-902 | WP-33 | ADM, API, DB | household, member | E2E, INT |
| NFR-06 | US-907 | WP-10 | DB, API | chore_completion_event | DB, U |
| NFR-07 | US-904 | WP-07 | OBS, API | job_run | INT, REV |
| NFR-08 | US-909 | WP-01, WP-41 | CICD | — | REV |
| NFR-09 | US-101, US-901 | WP-02 | DB | all tables | DB |
| NFR-10 | US-903 | WP-24 | DB | — | REV |
| NFR-11 | US-906 | WP-31 | BRD, ADM, UI | — | E2E, REV |
| PTS-01 | US-309, US-1101, US-1106 | WP-16 | DB, API, ADM | points_ledger, chore_occurrence | DB, U, E2E |
| PTS-02 | US-1102 | WP-11, WP-16, WP-20 | BRD, DB | v_points_balance, points_ledger | E2E |
| PTS-03 | US-1103 | WP-18 | ADM, API, BRD | reward_catalog_item | E2E, DB |
| PTS-04 | US-1104, US-1105 | WP-18, WP-20 | BRD, ADM, API, DB, OUTBOX | redemption, points_ledger, reward_catalog_item | E2E, DB, INT |
| PTS-05 | US-1107 | WP-30 | SCHED, RULES, ADM | points_rule, points_ledger | U, INT |
| PTS-06 | US-1108 | WP-30 | BRD, DB | reward_catalog_item, v_points_balance | E2E |
| PTS-07 | US-1109 | WP-02, WP-04, WP-16 | ADM, DB, RULES | member, points_ledger | DB, E2E |
| NFR-12 | US-908, US-911 | WP-01, WP-02, WP-15 | all | — | CI |
| NFR-13 | US-910 | WP-37 | BRD, ADM, UI | — | E2E, REV |
| NFR-14 | US-911 | WP-01, WP-41 | CICD | — | CI, REV |

---

## C. Coverage summary

| Phase | Must | Should | Could | Total |
|---|---|---|---|---|
| P0 | 13 | 1 | 0 | 14 |
| P1 | 51 | 5 | 0 | 56 |
| P2 | 12 | 6 | 1 | 19 |
| P3 | 0 | 5 | 3 | 8 |
| **Total** | **76** | **17** | **4** | **97** |

- Requirements: **97** · with at least one story: **97** · stories: **86** (P0: 12 · P1: 51 · P2: 15 · P3: 8).
- With at least one work package: **97** · work packages: **41**.
- Generated by `check_traceability.py --fix`; do not edit by hand.

---

## D. Component index (reverse trace)

| Component | Requirements |
|---|---|
| `BRD` | BRD-01, BRD-02, BRD-03, BRD-04, BRD-05, BRD-06, BRD-07, CAL-03, CAL-04, CAL-05, CHR-04, CHR-07, CHR-09, CHR-11, CHR-12, CHR-13, DEV-01, DEV-04, DEV-05, DEV-06, DEV-07, DEV-08, MEAL-01, MEAL-05, MEAL-06, NFR-01, NFR-02, NFR-03, NFR-11, NFR-13, PTS-02, PTS-03, PTS-04, PTS-06, RWD-07, RWD-08 |
| `ADM` | ACC-01, ACC-02, ACC-03, ACC-04, ACC-05, ACC-06, BRD-05, CAL-01, CAL-03, CAL-05, CAL-06, CHR-01, CHR-05, CHR-06, CHR-07, CHR-08, CHR-09, CHR-10, CHR-11, CHR-13, CHR-14, CHR-15, CHR-16, CHR-17, DEV-01, DEV-03, MEAL-01, MEAL-02, MEAL-03, MEAL-04, MEAL-05, MEAL-07, MEAL-08, MENU-01, MENU-03, MENU-04, NFR-05, NFR-11, NFR-13, PTS-01, PTS-03, PTS-04, PTS-05, PTS-07, RWD-01, RWD-09, RWD-10, RWD-12, SCH-01, SCH-04 |
| `API` | ACC-03, ACC-05, BRD-04, BRD-07, CHR-01, CHR-04, CHR-05, CHR-06, CHR-08, CHR-09, CHR-13, DEV-01, DEV-06, MEAL-03, NFR-04, NFR-05, NFR-06, NFR-07, PTS-01, PTS-03, PTS-04, RWD-01, RWD-04, RWD-06, RWD-09, RWD-13 |
| `AUTH` | DEV-01, DEV-02, DEV-03 |
| `RULES` | CHR-10, PTS-05, PTS-07, RWD-02, RWD-03, RWD-04, RWD-05, RWD-06, RWD-10, RWD-11, RWD-12, RWD-13 |
| `OCCGEN` | CHR-02, CHR-03, CHR-09, CHR-11, CHR-12, SCH-03 |
| `CALSYNC` | CAL-01, CAL-02, CAL-03, CAL-06, CAL-07, CAL-08, SCH-04 |
| `MENUIMP` | MEAL-05, MENU-01, MENU-02, MENU-03, MENU-04, MENU-05 |
| `NOTIFY` | CHR-15, CHR-16, CHR-17 |
| `OUTBOX` | CHR-04, DEV-06, NFR-01, PTS-04 |
| `SCHED` | CAL-02, CHR-03, CHR-07, CHR-12, CHR-16, MENU-05, PTS-05, RWD-04, RWD-06, RWD-11 |
| `DB` | ACC-01, ACC-04, ACC-05, CAL-05, CHR-02, CHR-03, CHR-04, CHR-07, CHR-08, CHR-09, CHR-10, CHR-12, CHR-13, CHR-15, CHR-16, DEV-02, DEV-05, MEAL-04, NFR-04, NFR-05, NFR-06, NFR-09, NFR-10, PTS-01, PTS-02, PTS-04, PTS-06, PTS-07, RWD-02, RWD-04, RWD-11, RWD-13, SCH-01, SCH-02, SCH-03 |
| `RT` | DEV-05 |
| `VAULT` | CAL-01, CAL-08, NFR-04 |
| `SAUTH` | ACC-02, ACC-03, ACC-06, DEV-01, DEV-02, NFR-04 |
| `PI` | DEV-04, DEV-07, NFR-02 |
| `OBS` | CAL-06, DEV-08, MENU-04, NFR-07 |
| `UI` | NFR-11, NFR-13 |
| `CICD` | NFR-08, NFR-14 |

`all` (NFR-12) applies to every component. Generated by `check_traceability.py --fix`.

---

## E. Milestones, exit criteria and launch

Work packages (`05-backlog.md`) are assigned to these milestones. A milestone is done when its exit criteria pass in CI and on a preview environment. Milestones are not release gates: nothing goes live until every milestone is done and the launch acceptance checklist below passes (D-19). Independent work packages may run in parallel; the sequence is chosen so that no finished work package needs rework.

| Milestone | Scope | Exit criteria (CI + preview) |
|---|---|---|
| **P0 Foundation** | Repo, CI/CD pipeline, tenancy schema + RLS, admin auth, members, device pairing, board shell, realtime, job framework, brand system | All PR gates green; pgTAP isolation and revoked-device tests green; on a preview, an admin signs in (magic link and password), creates a household and child, pairs a browser as a board, and sees a rename within 3 s; production deploy pipeline (migrate → app → smoke) green |
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
| L-09 | Production data reset with the launch runbook; household created; second admin invited; board paired | `01` §9.7 |
| L-10 | Each parent receives reminders on their own iPhone for 7 days: on time, once per item, none after an item is done, none during quiet hours, private titles hidden; turning reminders off stops them | CHR-15..17 |

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
| R-03 | Device session longevity / Realtime under RLS unproven | Med | High | SPIKE-01 before building on it |
| R-04 | iCloud published-calendar behavior changes or lacks fidelity | Med | Med | SPIKE-02; CalDAV fallback; last-good retention |
| R-05 | School menu feed unavailable or unofficial | Med | Med | The district's Nutrislice feed is public but undocumented, so it could change: adapter isolated behind the interface, last good menu cached, CSV/manual fallback, failures surfaced (MENU-04) |
| R-06 | Supabase Free project paused for inactivity, or vendor outage | Med | High | Keepalive heartbeat four times a day to both projects; failure email; restore runbook; offline cache keeps the board usable |
| R-07 | Pi hardware (SD corruption, touch driver, panel latency) | Med | High | NVMe/SSD boot; SPIKE-03 on the real panel |
| R-08 | Maintenance burden on a single builder | High | High | Automated PR gates and ordered deploys; no feature that needs weekly care; health page and alerts |
| R-09 | Child data privacy | Low | High | Minimal fields, no trackers, export/delete |
| R-10 | Time bugs (DST, timezone, day rollover) | Med | High | Household timezone authoritative; fixtures and property tests |
| R-11 | Vercel cron/function duration limits | Med | Med | `pg_cron` + `pg_net`; one-source-per-invocation; SPIKE-05 |
| R-12 | Points economy: inflation, a reversal after a spend creating a debt, parents forgetting to fulfil | Med | Med | Costs are admin-tunable; negative balances shown neutrally as points to earn back; request check uses balance minus open requests; admin adjustments are ledger entries with reasons |
| R-13 | Self-check with parent verification in real life invites "check everything" behavior | Med | Med | Bulk uncheck (CHR-08) with a batch id; optional approval per chore; insights show override rate; no punitive wording on the board |
| R-14 | 4K rendering on Pi 5 is too slow for animations | Med | Med | SPIKE-03; logical 1080p layout with DPR 2; compositor-only animations; documented 1080p output fallback |
| R-15 | Day-close job skipped or late, leaving stale `scheduled` days | Low | Med | Hourly idempotent job with catch-up; stale-day alert on the health page; `rebuild_occurrence_status` drift check |
| R-16 | Database tests run on native Postgres with a compatibility bootstrap (no Docker), which can drift from real Supabase | Med | Med | Bootstrap mirrors only platform objects; every e2e run applies all migrations to the real preview project; pgTAP on the preview project once role switching is verified; production deploy smoke check |
| R-17 | Pi and panel not yet available, so the 4K budget (SPIKE-03) is validated late | Med | Med | Build to the 1920×1080 logical / DPR 2 spec; compositor-only animations; desktop Chromium at 3840×2160 DPR 2 in e2e; WP-14 and launch check L-08 run when hardware arrives |
| R-18 | Device clock skew affects event-time conflict resolution | Low | Med | Server clamps `occurred_at` to receipt time; board events outside the due date are flagged for a parent (D-20, D-21) |
| R-19 | Supabase's built-in email reaches only team members, about 2 per hour, so magic links and resets can fail | High | Med | Password sign-in needs no email; invites are shareable links; add both parents to the Supabase team; custom SMTP once a domain exists (OQ-06b) |
| R-20 | No automatic backups on Supabase Free | Med | High | Nightly encrypted `pg_dump` kept 30 days; rehearsed restore into the preview project (WP-24, L-06) |
| R-21 | Free-plan limits or policies change | Low | Med | Usage on System Health; the cost ceiling records that a paid upgrade is a deliberate decision |
| R-22 | Parents keep their own to-dos in other apps, so the family list goes stale and the board loses trust | Med | High | My tasks on the phone with quick add (CHR-14); the Family view shows everyone's day; reminders by web push, switchable per person (D-35) |
| R-23 | A private item leaks through the board snapshot, an audit row, or the other admin's view | Low | High | One RLS rule on the item, its occurrences, events and audit rows; pgTAP proves the board and the other admin see nothing; the snapshot reads through RLS |
| R-24 | Web push on iPhone works only for the admin app added to the Home Screen with permission granted, and Apple can change the rules | Med | Med | Onboarding step with a test notification; Settings lists each device's last delivery; My tasks and the board work without push; launch check L-10 on real phones |
| R-25 | Production secrets are repository secrets, readable by any workflow run on any branch (GitHub Free, private repository) | Low | High | Only the owner and Claude Code push; workflow changes are reviewed in the pull request diff; the Vercel token is scoped to the team and expires; the database password and the token can be rotated from their dashboards |
| R-26 | A commit reaches `main` without passing its checks, since GitHub Free does not enforce branch protection on a private repository | Low | Med | The deploy gate refuses to ship it and the failed run emails the owner; fix forward in a pull request or revert (D-36) |

### Spikes (time-boxed, before dependent work)

| ID | Question | Unblocks |
|---|---|---|
| SPIKE-01 | Do device-as-Supabase-Auth-user sessions stay valid for months on a kiosk, and do Realtime + RLS behave with the `device_household_id()` check? | DEV-01, DEV-02, DEV-05 |
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
| A-09 | Free plans only: Supabase Free (two projects), Vercel Hobby, GitHub Free. |
| A-10 | Family members trust each other at the board: anyone can check off any family-visible item, and each check-off records who did it and that it came from the board. |
| A-11 | Parents use iPhones on iOS 16.4 or later and add the admin app to the Home Screen, which web push requires. |
| A-12 | The repository stays private, and only the owner and Claude Code (acting for the owner) push to it. |

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

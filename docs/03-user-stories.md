# 03 — User Stories

> Version 0.5 · Status: build baseline · Maintained by Claude Code
> v0.5: free plans (D-29): backups (US-903), cost and pausing (US-909) and previews (US-911) updated.
> v0.4: magic link + password sign-in (US-102) with Apple/passkey later (US-106); event-time conflicts (US-205); today-only board and parent-only late credit (US-303, US-307); approval switch and day-close rules (US-310, US-307); closures spare today (US-602); delivery pipeline (US-911).
> Each story lists its `Reqs:` (defined in `04-requirements-traceability.md`). Acceptance criteria are Given/When/Then and are the basis for Playwright, Vitest, and pgTAP test names (prefix tests with the story or requirement ID, e.g. `[US-304][CHR-04]`).

## Personas

| ID | Persona | Description |
|---|---|---|
| **Kid** | Child | Uses the 32" 4K touch board. One child in v1 (schema supports more). Icon-first UI. Never signs in. |
| **Admin** | Parent | Manages everything from phone/laptop. Two admins in v1. |
| **Board** | Device | The paired kiosk; it is only the interactive front end and acts on behalf of the household, not a person. |
| **System** | Platform | Scheduled jobs and derived-data maintenance. |

Priority uses MoSCoW. Phases: **P0** foundation · **P1** kid loop and rewards (built as P1a–P1d) · **P2** meals, menu and extras · **P3** polish. Nothing goes live until every phase is built (D-19).

---

## E1 — Household and access

### US-101 — Create the household
**As an** admin **I want** to create my household with a name and timezone **so that** all dates, schedules, and day boundaries are correct.
**Priority:** Must · **Phase:** P0 · **Reqs:** ACC-01, NFR-09
- Given I have signed in for the first time, when I save a household with timezone `America/Detroit`, then a household and settings row exist and every later record I create carries that `household_id`.
- Given a second household exists, when I query as a member of the first, then I see zero rows from the second.

### US-102 — Sign in securely
**As an** admin **I want** to sign in with an emailed magic link or with my email and password **so that** only parents can manage the board.
**Priority:** Must · **Phase:** P0 · **Reqs:** ACC-02, NFR-04
- Given I enter my email and choose "Email me a link", when I open the link before it expires, then I land on `/admin` for my household.
- Given I have set a password, when I sign in with my email and password, then I land on `/admin` for my household; a wrong password shows a neutral error and does not reveal whether the email exists.
- Given I forgot my password, when I request a reset, then I receive a reset link and can set a new password.
- Given I am not signed in, when I request any `/admin` route, then I am redirected to sign-in.
- Given a paired board session, when it calls an admin route, then it receives 403.

### US-103 — Invite my spouse
**As an** admin **I want** to invite another parent by email **so that** we can both manage the board.
**Priority:** Must · **Phase:** P0 · **Reqs:** ACC-03
- Given I send an invite, when the recipient opens the link before expiry and signs in, then they become an admin of my household.
- Given an invite is expired or already used, when it is opened, then it is rejected and I can resend.

### US-104 — Manage family members
**As an** admin **I want** to add children and adults with a name, avatar, and color **so that** chores, goals, and meals can be assigned per person.
**Priority:** Must · **Phase:** P0 · **Reqs:** ACC-04
- Given I add a child, when I save, then they appear on the board's child selector without any login being created.
- Given I archive a child, when the board refreshes, then their active chores and goals no longer display but history is retained.

### US-105 — Review the audit trail
**As an** admin **I want** to see who changed chores, goals, and devices and when **so that** I can resolve "who changed that?" questions.
**Priority:** Should · **Phase:** P3 · **Reqs:** ACC-05
- Given an admin edits a goal's rules, when I open the audit log, then I see actor, time, entity, and a before/after diff.
- Given a device is revoked, when I open the log, then the action and actor are recorded.

### US-106 — Sign in with Apple or a passkey
**As an** admin **I want** to add Sign in with Apple or a passkey to my account **so that** I can sign in quickly on my Apple devices.
**Priority:** Should · **Phase:** P3 · **Reqs:** ACC-06
- Given the production domain is configured, when I choose Sign in with Apple and authentication succeeds, then I land on `/admin` for my household and my existing account is linked, not duplicated.
- Given I am signed in, when I enroll a passkey and later sign in with it, then I land on `/admin` without entering a password.
- Given either method fails or is cancelled, when I return to sign-in, then magic link and password still work.

---

## E2 — Device and board shell

### US-201 — Pair the board
**As an** admin **I want** to pair the kitchen display using a short code **so that** it shows my household without anyone signing in on it.
**Priority:** Must · **Phase:** P0 · **Reqs:** DEV-01, DEV-02
- Given I generate a code in admin, when the board submits it within 10 minutes, then the board receives a device session and loads the household's data.
- Given a code was already used or expired, when it is submitted, then it is rejected.
- Given a paired board, when it attempts to write anything other than completions, then the request is denied.

### US-202 — Manage and revoke devices
**As an** admin **I want** to see, rename, and revoke paired devices **so that** a lost or retired display can't access my family's data.
**Priority:** Must · **Phase:** P0 · **Reqs:** DEV-03, DEV-02
- Given a device is listed, when I view it, then I see name, status, and last-seen time.
- Given I revoke a device, when it next queries or its realtime channel receives data, then access is denied immediately and it returns to the pairing screen.

### US-203 — Lock the kiosk to the board
**As an** admin **I want** the display to be locked to the board experience **so that** my child can't wander into admin or the browser.
**Priority:** Must · **Phase:** P1 · **Reqs:** DEV-04
- Given the Pi boots, when it finishes starting, then Chromium opens full-screen at `/board` with no address bar or browser chrome.
- Given the board is showing, when the child long-presses, swipes from edges, or uses pinch, then no browser UI, context menu, or navigation outside `/board` appears.

### US-204 — See changes live
**As a** parent **I want** changes I make on my phone to appear on the board within seconds **so that** the board is trustworthy.
**Priority:** Must · **Phase:** P0 · **Reqs:** DEV-05
- Given the board is online, when I add a chore from my phone, then the board shows it within 3 seconds (p95).
- Given realtime disconnects, when the connection returns, then the board refetches and reconciles without a manual refresh.

### US-205 — Keep working offline
**As a** parent **I want** the board to keep working when wifi drops **so that** the habit doesn't break.
**Priority:** Must · **Phase:** P1 · **Reqs:** DEV-06, NFR-01
- Given wifi is off, when the child checks off chores, then the UI updates instantly and the events are queued.
- Given wifi returns, when the outbox replays, then each event is applied exactly once and the board shows server-authoritative state.
- Given the board has been offline for 24 hours, when it is opened, then it displays the last cached day's data with a stale indicator.
- Given the child checked off a chore offline at 7:00 and a parent unchecked it on the phone at 7:30, when the board's 7:00 event replays at 8:00, then the chore stays open because the later event by time wins.
- Given the board's clock runs ahead, when its events reach the server, then their time is capped at the time the server received them.

### US-206 — Know when data is stale
**As a** parent **I want** a subtle indicator when the board's data is old **so that** I know when not to trust it.
**Priority:** Should · **Phase:** P1 · **Reqs:** DEV-08
- Given the last snapshot is older than 5 minutes or realtime is disconnected, when the board renders, then a discreet stale icon appears.
- Given a calendar source's last success is older than three sync intervals, when the calendar view renders, then it shows a "calendar may be out of date" badge.

### US-207 — Quiet hours and burn-in protection
**As an** admin **I want** the display to dim or sleep overnight and avoid static pixels **so that** it's not a night light and the panel lasts.
**Priority:** Should · **Phase:** P3 · **Reqs:** DEV-07
- Given quiet hours 21:00–06:30, when the time is reached, then the board dims to a minimal clock layout (or powers the screen down on the Pi) and touch wakes it.
- Given the board is idle, when more than 10 minutes pass, then the layout drifts or dims to avoid static high-contrast elements.

---

## E3 — Chores and tasks

### US-301 — Create a chore or task
**As an** admin **I want** to create chores and one-off tasks with icon, assignees, points, and optional approval **so that** each child has clear responsibilities.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-01
- Given I save a chore with a title, icon, and one assignee, when I view the chore list, then it appears and occurrences exist for the next 14 days where scheduled.
- Given I set "requires approval", when the child completes it, then its state is `pending_approval`.

### US-302 — Schedule chores around the school year
**As an** admin **I want** chores to recur on chosen days and only on certain day types **so that** school-day routines differ from weekends and summer.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-02, SCH-03
- Given a chore scheduled weekdays with day type `school_day`, when a weekday falls inside a break, then no occurrence is generated for that date.
- Given a one-off task with `on_date`, when that date arrives, then exactly one occurrence exists.

### US-303 — See my chores for today
**As a** kid **I want** to see today's chores as big pictures **so that** I know what to do without help.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-03, BRD-01
- Given today has three scheduled chores for me, when I open the board, then I see exactly those three with icons and my progress for the day.
- Given a chore isn't scheduled today, when I open the board, then it is not shown.
- Given yesterday had unfinished chores, when I open the board, then only today's chores appear; catching up a past day is done by a parent.

### US-304 — Check off a chore
**As a** kid **I want** to tap a chore to mark it done **so that** I get credit and see my progress grow.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-04
- Given a scheduled chore, when I tap it, then it shows complete within 100 ms and a completion event is recorded exactly once.
- Given I double-tap rapidly, when events reach the server, then only one effective completion exists (idempotent).
- Given the chore does not require approval (the default), when I check it off, then its status becomes `completed` immediately and points are earned; a parent verifies in real life afterwards.

### US-305 — Undo an accidental tap
**As a** kid **I want** to undo a mistaken tap right away **so that** I'm not credited for something I didn't do.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-04
- Given I completed a chore less than the undo window ago (default 2 minutes), when I tap it again, then it returns to `scheduled` via a compensating `undo` event.
- Given the undo window has passed, when I tap, then I cannot undo; an admin can.

### US-310 — Turn approval on or off
**As an** admin **I want** to switch the approval workflow on or off, and override it per chore **so that** we can tighten or relax oversight as trust builds.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-05
- Given approval is off, when my child checks off a chore, then it counts immediately and a parent can still uncheck it later.
- Given approval is on, when my child checks off a chore, then it shows as pending on the board and earns no points until I approve it.
- Given I set one chore to "never needs approval" while approval is on, when it is checked off, then it counts immediately.
- Given I switch approval on mid-week, when I save, then `scheduled` occurrences follow the new setting and completed ones are unchanged.
- Given check-offs are waiting for approval, when I switch approval off, then they stay in my approval queue until I decide them.

### US-306 — Approve completions (optional)
**As an** admin **I want** to optionally require approval on specific chores, and to review what was checked off **so that** credit reflects real effort.
**Priority:** Should · **Phase:** P1 · **Reqs:** CHR-05
- Given a chore is `pending_approval`, when I approve it, then it counts toward goals and the board updates.
- Given I reject it, when the board refreshes, then it shows as not done and the child can try again.
- Given a chore does not require approval, when a parent finds it was not actually done, then they can reverse it (US-309) and the earned points are reversed.

### US-307 — Mark done, undone, or skipped as a parent
**As an** admin **I want** to check chores off for my child, undo them, or skip a day **so that** sick days and corrections don't unfairly break progress.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-06, CHR-07
- Given a scheduled occurrence in the past, when I mark it `skip`, then it is excluded from streak and count denominators.
- Given an occurrence is still `scheduled` or `rejected` when the household-local day ends, when the day-close job runs, then its `status` becomes `missed`, `finalized_at` is set, and the day's `member_daily_summary` row is written.
- Given the day-close job runs twice, when it finishes, then the result is identical (idempotent).
- Given a missed occurrence, when a parent completes it late, then it folds to `approved`, points are earned, and the day's history is re-derived.
- Given the board was offline across midnight, when a check-off whose time falls outside the chore's due date replays, then it is stored as flagged and waits for a parent as `pending_approval`.

### US-309 — Uncheck a batch of chores
**As an** admin **I want** to select several chores my child checked off but did not actually do and uncheck them together **so that** points and progress stay honest without tedious one-by-one edits.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-08, CHR-06, PTS-01
- Given 5 occurrences are `completed`, when I select 4 and choose "Not actually done", then 4 `admin_uncomplete` events are written with one shared `batch_id` and they return to `scheduled` (or `missed` if the day is closed).
- Given those occurrences had earned points, when the batch is applied, then matching reversal entries are posted to the points ledger exactly once.
- Given the batch is applied, when the board refreshes, then the child sees the chores open again without a punitive message.

### US-308 — Edit a chore without rewriting history
**As an** admin **I want** edits to a chore to affect only future occurrences **so that** past credit and streaks stay intact.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-03
- Given a chore with past completions, when I change its title and schedule, then past occurrences and their completions are unchanged and future `scheduled` occurrences are regenerated.
- Given I change points, when I view a past occurrence, then it shows its original `points_snapshot`.

---

## E4 — Rewards

### US-401 — Create a reward goal
**As an** admin **I want** to define a reward with start and end dates and rules **so that** my child works toward something specific.
**Priority:** Must · **Phase:** P1 · **Reqs:** RWD-01, RWD-02, RWD-03
- Given I create a goal "Movie night" with a 14-day window and rules (COUNT ≥ 20 morning chores) AND (STREAK ≥ 5), when I save, then its status is `scheduled` or `active` depending on the start date.
- Given the rule logic is `any`, when only one rule is met, then the goal is achieved.

### US-402 — Streaks that forgive
**As an** admin **I want** streaks to tolerate a limited number of misses and ignore non-chore days **so that** one bad day doesn't crush motivation.
**Priority:** Must · **Phase:** P1 · **Reqs:** RWD-05
- Given `grace_per_week = 1`, when my child misses one scheduled day in a week, then the streak is preserved and not extended.
- Given weekends have no scheduled chores, when a streak spans a weekend, then weekend days neither extend nor break it.
- Given it is 2 pm and today's chores are incomplete, when the streak is evaluated, then today is not counted as a miss.

### US-408 — See good and bad streaks over time
**As a** parent **I want** a history of good and bad streaks, including missed days **so that** I can see patterns and the board can show my child's current streak.
**Priority:** Must · **Phase:** P1 · **Reqs:** RWD-11, RWD-12
- Given 6 finalized days with all chores done, when I open Insights, then I see a current good streak of 6 and a heatmap of good days.
- Given 3 consecutive finalized days with missed chores, when I open Insights, then a bad streak of 3 is shown, and today (still open) is not counted as bad.
- Given weekends have no chores, when a run spans a weekend, then those days are neutral and do not break the raw streak.
- Given history is rebuilt from events, when I compare it with the stored `streak_segment` rows, then they match.
- Given I open Insights, when I choose a date range, then I see completion rate, best good streak, longest bad streak, and the most-missed chores.
- Given a date range, when I view the trust panel, then I see how many check-offs were reversed or rejected by a parent, the reversal rate over time, and the average time to verify, so I can decide whether approval should be on.

### US-409 — Goals can pay out points or a prize
**As an** admin **I want** to choose what achieving a goal pays out **so that** goals and the points economy work together.
**Priority:** Should · **Phase:** P1 · **Reqs:** RWD-13
- Given a goal with payout "50 points", when it becomes achieved, then exactly one `bonus` ledger entry of 50 is posted (idempotent on replay).
- Given a goal with payout "catalog item", when it becomes achieved, then an approved redemption is created for that item.
- Given a goal with payout "custom", when it becomes achieved, then only the celebration and the redeem step apply.
- Given a goal is achieved because of a chore that is later reversed, when evaluated, then the goal returns to `active`, its progress drops, and a points payout is reversed by a ledger entry.
- Given the reward for that goal was already fulfilled, when the goal becomes unachieved, then the fulfilled status is kept and the admin sees a review flag; the points reversal still posts.
- Given the goal is met again, when evaluated, then it is achieved again with a new celebration and a new payout.

### US-403 — See progress toward the goal
**As a** kid **I want** a visual path to my reward **so that** I can see how close I am.
**Priority:** Must · **Phase:** P1 · **Reqs:** RWD-07
- Given an active goal at 60%, when I open the Goals screen, then I see a meter/path at 60% with current and best streak.
- Given I'm one chore from finishing, when I open Today, then I see a nudge naming the goal.

### US-404 — Celebrate wins
**As a** kid **I want** a celebration when I finish a chore and when I earn my reward **so that** it feels great to do.
**Priority:** Must · **Phase:** P1 · **Reqs:** RWD-08
- Given I complete a chore, when it saves, then a short animation (and optional sound) plays and honors the reduced-motion setting.
- Given my goal becomes achieved, when the board next renders, then a full-screen celebration plays once (tracked by `celebrated_at`).

### US-405 — Redeem rewards
**As an** admin **I want** to mark an achieved reward as redeemed **so that** the loop closes and we keep history.
**Priority:** Must · **Phase:** P1 · **Reqs:** RWD-06, RWD-09
- Given a goal is `achieved`, when I mark it redeemed, then status becomes `redeemed` with timestamp and my identity, and it moves to history.
- Given a goal's end date passes before achievement, when the job runs, then status becomes `expired`.

### US-406 — Change rules mid-flight safely
**As an** admin **I want** to preview what a rule change does before saving **so that** I don't accidentally erase earned progress.
**Priority:** Should · **Phase:** P1 · **Reqs:** RWD-10, RWD-04
- Given an active goal, when I edit a target and open the preview, then I see old vs new progress computed from full history.
- Given I save, when evaluation runs, then a `rules_changed` and `recomputed` event are logged.

### US-407 — Progress stays correct after glitches
**As a** parent **I want** progress to be correct even after outages or retries **so that** my child never loses credit.
**Priority:** Must · **Phase:** P1 · **Reqs:** RWD-04
- Given a completion was stored but evaluation failed, when the reconcile job runs, then the dirty goal is recomputed within 5 minutes.
- Given the same event is replayed, when evaluated, then progress is unchanged.

---

## E5 — Calendar

### US-501 — Connect an Apple calendar (read-only)
**As an** admin **I want** to add my family iCloud calendar by link **so that** events show on the board while I keep editing them in Apple Calendar.
**Priority:** Must · **Phase:** P1 · **Reqs:** CAL-01, CAL-03
- Given I paste a published ICS URL, when I save, then the URL is stored only in Vault, a first sync runs, and events appear.
- Given any UI surface, when I look for event create/edit controls, then none exist for synced calendars.

### US-502 — Events stay fresh and correct
**As an** admin **I want** calendars to refresh automatically and handle recurring events, all-day events, and DST correctly **so that** the board matches my phone.
**Priority:** Must · **Phase:** P1 · **Reqs:** CAL-02, CAL-07
- Given an event is added in Apple Calendar, when 15 minutes pass, then it appears on the board.
- Given a weekly event spans a DST change, when instances are expanded, then local start time is unchanged.
- Given an all-day event, when displayed, then it occupies the correct local date(s) regardless of device timezone.

### US-503 — Browse the calendar by touch
**As a** kid **I want** to scroll through day, week, and month views **so that** I can see what's coming up.
**Priority:** Must · **Phase:** P1 · **Reqs:** CAL-04
- Given the Calendar tab, when I swipe or tap arrows, then I can move between days, weeks, and months with smooth scrolling.
- Given 40 events in a month, when I open month view, then it renders without lag and shows overflow as "+N more".

### US-504 — Color-code by person
**As an** admin **I want** each calendar to have a color and optional family member **so that** events are easy to scan.
**Priority:** Should · **Phase:** P1 · **Reqs:** CAL-05
- Given a calendar colored blue and linked to Dad, when its events render, then they use blue and show Dad's avatar.
- Given I hide a calendar from the board, when the board refreshes, then its events disappear.
- Given the calendar is hidden on this device, when I look at another device, then its own selection is unaffected.

### US-507 — Choose which calendars the board shows
**As an** admin **I want** to pick exactly which of the connected calendars appear on the board **so that** the display shows what the family needs and nothing else.
**Priority:** Must · **Phase:** P1 · **Reqs:** CAL-05
- Given 4 connected calendars, when I tick 2 for this board, then only those 2 appear in Today, Day, Week and Month views within 3 seconds.
- Given a new calendar is connected, when a device has a custom selection, then the new calendar is hidden on that device until I enable it.
- Given I deselect a calendar, when I reselect it, then its color and member association are kept.

### US-505 — See calendar sync health
**As an** admin **I want** to see last-sync time and errors **so that** I can fix a broken link without guessing.
**Priority:** Must · **Phase:** P1 · **Reqs:** CAL-06
- Given a sync fails, when I open Calendars, then I see the error and last success time, and the board still shows the last good events.
- Given the link is fixed, when the next sync succeeds, then status returns to OK.

### US-506 — Use CalDAV with a safer credential
**As an** admin **I want** CalDAV support with guidance on a secondary read-only Apple ID **so that** private calendars work without exposing my main account.
**Priority:** Could · **Phase:** P2 · **Reqs:** CAL-08
- Given I add a CalDAV source, when I save, then username and password go to Vault and a warning explains the scope of app-specific passwords.
- Given sync succeeds, when I view the source, then only the calendars shared with that account are listed.

---

## E6 — School year and day context

### US-601 — Configure the school year
**As an** admin **I want** to set school year dates, terms, breaks, and no-school days **so that** the system knows when school is in session.
**Priority:** Must · **Phase:** P1 · **Reqs:** SCH-01
- Given I create a school year with start/end dates and add a winter break and a teacher day, when I save, then they appear on a timeline.
- Given I add next year's calendar, when I view settings, then multiple years coexist and one is marked default.

### US-602 — Behavior follows the day type
**As a** parent **I want** chores and lunches to adapt to school days, breaks, weekends, and summer **so that** I don't maintain separate setups.
**Priority:** Must · **Phase:** P1 · **Reqs:** SCH-02, SCH-03
- Given a date inside a break closure, when the day type resolves, then it is `break`; on a Saturday it is `weekend`; outside any school year it is `summer`.
- Given chores restricted to `school_day`, when a snow-day closure is added for a future date, then that date's occurrences are removed and past ones are untouched.
- Given a closure is added for today, when I save, then today's occurrences are left as they are; only later dates change.

### US-603 — Import no-school days from a calendar
**As an** admin **I want** to pull no-school days from the school calendar feed **so that** I don't re-enter them.
**Priority:** Could · **Phase:** P3 · **Reqs:** SCH-04
- Given a calendar source tagged "school", when I run import, then I can preview and accept events as closures.
- Given a closure already exists on that date, when I import, then it is not duplicated.

---

## E7 — Meal planning

### US-701 — Plan the week
**As an** admin **I want** to plan breakfast, snack, lunch, and dinner for each day **so that** we stop deciding at 5 pm.
**Priority:** Must · **Phase:** P2 · **Reqs:** MEAL-01, MEAL-02, MEAL-08
- Given a week view with 4 slots × 7 days, when I add a saved meal or free text to a slot, then it shows on that day.
- Given a day, when I add two snacks, then both display in order.
- Given a family dinner vs a per-child lunch, when I add entries, then I can scope each to the household or one member.

### US-702 — Copy last week
**As an** admin **I want** to copy a previous week or reuse meals **so that** planning takes minutes.
**Priority:** Should · **Phase:** P2 · **Reqs:** MEAL-03
- Given last week is planned, when I choose "Copy to this week", then all entries are duplicated and editable.
- Given destination slots already have entries, when I copy, then I choose to skip or overwrite.

### US-703 — Buyer or bringer
**As an** admin **I want** to set lunch as "buy" or "bring" per school day, with weekday defaults **so that** packed lunches and school lunches are clear.
**Priority:** Must · **Phase:** P2 · **Reqs:** MEAL-04
- Given defaults of Friday = buy and others = bring, when I open a school week, then each day shows the default and I can override a single date.
- Given a weekend or break day, when I view lunch, then no buy/bring selector is shown.

### US-704 — See the school menu on buy days
**As an** admin **I want** buy days to show that day's school lunch **so that** I know what my child is choosing from.
**Priority:** Must · **Phase:** P2 · **Reqs:** MEAL-05
- Given Friday is "buy" and a menu exists, when I view Friday, then I see the school's lunch items.
- Given no menu exists for that date, when I view it, then I see "Menu unavailable" and can enter it manually.

### US-705 — Kid sees what's for dinner
**As a** kid **I want** to see today's meals on the board **so that** I know what's coming.
**Priority:** Must · **Phase:** P2 · **Reqs:** MEAL-06
- Given today's plan, when I open the Meals tab, then I see today's four slots with pictures and a "Lunch: buying today / bringing today" label.
- Given I try to edit a meal on the board, when I tap, then nothing changes (read-only).

### US-706 — Ready for a grocery list
**As an** admin **I want** meals to hold ingredients **so that** a future grocery list can be generated.
**Priority:** Could · **Phase:** P3 · **Reqs:** MEAL-07
- Given I add ingredients to a meal, when I save, then they are stored structured and exportable.
- Given a week is planned, when I request a consolidated ingredient export, then I receive de-duplicated quantities.

---

## E8 — School menu

### US-801 — Configure the menu source
**As an** admin **I want** to pick my school's menu platform and enter its settings **so that** menus load automatically.
**Priority:** Must · **Phase:** P2 · **Reqs:** MENU-01, MENU-02
- Given I choose an adapter and enter school identifiers, when I test the connection, then I see a sample week.
- Given my district's platform has no adapter, when I choose Manual/CSV, then planning still works fully.

### US-802 — Import or enter menus manually
**As an** admin **I want** to upload a CSV or edit a day's menu **so that** I can always fix or fill in menus.
**Priority:** Must · **Phase:** P2 · **Reqs:** MENU-03
- Given a valid CSV, when I upload it, then days are created with origin `csv` and a preview before commit.
- Given I edit a day's items, when I save, then it is flagged `is_override` and later adapter imports do not replace it.

### US-803 — Survive broken feeds
**As an** admin **I want** import failures surfaced and the last good menu kept **so that** lunch planning never breaks.
**Priority:** Must · **Phase:** P2 · **Reqs:** MENU-04, MENU-05
- Given the feed errors, when the daily import runs, then I see the error and last success time while the cached menu remains.
- Given a daily schedule, when it runs, then it fetches the next 28 days and leaves override rows untouched.

---

## E9 — Quality and operations

### US-901 — Data is isolated and secrets stay secret
**As an** admin **I want** strict data isolation and secure secret storage **so that** my family's information is protected.
**Priority:** Must · **Phase:** P0 · **Reqs:** NFR-04, NFR-09
- Given the pgTAP suite, when it runs, then it proves cross-household denial, revoked-device denial, and device read-only access.
- Given the client bundle and logs, when scanned, then they contain no service-role key or calendar secret.

### US-902 — Own my data
**As an** admin **I want** to export or delete my household's data **so that** I control a child's information.
**Priority:** Should · **Phase:** P3 · **Reqs:** NFR-05
- Given I click Export, when it completes, then I receive a bundle of all household data in JSON/CSV.
- Given I delete a child profile, when confirmed, then their PII is removed and events are anonymized.

### US-903 — Backups I can trust
**As an** admin **I want** automatic backups and a documented restore **so that** a mistake or outage doesn't erase the history.
**Priority:** Must · **Phase:** P1 · **Reqs:** NFR-10
- Given the nightly encrypted backup ran, when I follow the restore runbook in a drill, then the database is recovered into the preview project as of that night.
- Given the runbook, when read, then it states RPO/RTO and steps to re-pair the board.

### US-904 — Know when something breaks
**As an** admin **I want** errors and job health visible **so that** I find problems before the family does.
**Priority:** Should · **Phase:** P1 · **Reqs:** NFR-07
- Given any job fails, when I open System Health, then I see job, time, and message.
- Given an unhandled server error, when it occurs, then it is logged with request ID and no PII.

### US-905 — Fast and finger-friendly
**As a** kid **I want** big buttons that respond instantly **so that** using the board is easy.
**Priority:** Must · **Phase:** P1 · **Reqs:** NFR-02, NFR-03, BRD-03
- Given a Pi 5 on the reference panel, when the board loads from cache, then it is interactive in under 2 seconds.
- Given any child-facing control, when measured, then its touch target is at least 56 logical px (about 21 mm on the 4K reference panel) and text is legible at 2 m.
- Given the 3840×2160 panel with the UI laid out at 1920×1080 logical px and device scale factor 2, when I use the board, then celebrations and scrolling stay smooth (SPIKE-03 sets the frame-rate budget; the 1080p fallback is documented).

### US-906 — Accessible by design
**As a** family member **I want** high contrast, non-color-only cues, and reduced motion **so that** everyone can use the board.
**Priority:** Should · **Phase:** P2 · **Reqs:** NFR-11
- Given the board UI, when audited, then text meets WCAG AA contrast and status never relies on color alone.
- Given the reduced-motion setting is on, when celebrations trigger, then animations are replaced with static feedback.

### US-907 — History can't be rewritten by accident
**As an** admin **I want** completions to be append-only with UTC timestamps and local dates **so that** audits and recomputation are reliable.
**Priority:** Must · **Phase:** P1 · **Reqs:** NFR-06
- Given a completion event exists, when any user or API attempts to update or delete it, then the database rejects the operation.
- Given an event at 23:50 local, when stored, then `credit_date` equals the occurrence due date and `occurred_at` is UTC.

### US-908 — Tested core
**As a** developer **I want** the rules engine and RLS covered by automated tests **so that** changes don't silently break rewards or security.
**Priority:** Must · **Phase:** P0 · **Reqs:** NFR-12
- Given CI, when a PR opens, then lint, typecheck, rules-engine unit tests (≥90% coverage), pgTAP, and e2e run and block on failure.
- Given the rules engine, when run with property tests on random event orderings, then results are deterministic.

### US-909 — Costs stay predictable
**As an** admin **I want** the board to run on free plans with no surprise pauses **so that** it is dependable and costs nothing each month.
**Priority:** Should · **Phase:** P0 · **Reqs:** NFR-08
- Given the production and preview projects are on Supabase Free, when a week passes with no family use, then neither project is paused because the keepalive writes a heartbeat several times a day.
- Given a keepalive run fails, when it fails, then I receive an email and the runbook shows how to restore the project, while the board keeps showing cached data.
- Given usage, when it approaches a Free-plan limit, then a warning appears in System Health.
- Given the cost ceiling, when I review it, then the recurring cost is zero and any paid upgrade is a documented decision.

---

### US-911 — Changes ship through one safe pipeline
**As an** admin **I want** every change to pass automated checks and a preview before it reaches production **so that** a mistake never breaks the family's board.
**Priority:** Must · **Phase:** P0 · **Reqs:** NFR-14, NFR-12
- Given a pull request, when it is opened, then lint, typecheck, unit tests, database tests, traceability and build run without Docker, and the PR cannot merge until they pass.
- Given a pull request, when Vercel finishes its preview, then the preview database is rebuilt from that PR's migrations and seed, and the e2e suite runs against the preview; two PRs never test at the same time.
- Given a merge to `main`, when the deploy runs, then migrations are applied to production before the app is deployed, and a failed migration stops the app deploy.
- Given production before launch, when I look at it, then no board is paired and no family data exists until the launch runbook is run.

### US-910 — It looks and feels like FamilyWise
**As a** parent **I want** the board and admin to share one clear, friendly identity **so that** the product feels trustworthy to my family and consistent on every screen.
**Priority:** Must · **Phase:** P0 · **Reqs:** NFR-13
- Given any screen, when I inspect its styles, then colors, type, spacing, and radii come from the FamilyWise design tokens and no component hardcodes a hex value.
- Given a chore occurrence in each of the seven statuses, when it renders on the board, then it shows the status icon, label, and color from the guide in both Day and Evening themes.
- Given the board is offline or unpaired, when it loads, then it shows the FamilyWise splash, and the installed app, favicon, and touch icon use the FamilyWise icons.
- Given a member with an `avatar_key`, when their profile renders, then the matching avatar appears; given none, then initials on their member color appear.
- Given the board in Evening theme, when contrast is audited, then every text and icon pair meets WCAG AA.

---

## E10 — Board experience

### US-1001 — A "Today" home screen
**As a** kid **I want** one home screen with my chores, today's events, today's meals, and goal progress **so that** I see my day at a glance.
**Priority:** Must · **Phase:** P1 · **Reqs:** BRD-01
- Given I open the board, when Today loads, then I see date/time, my chores, up to five events, today's meals (P2), and the active goal meter.
- Given nothing is scheduled, when Today loads, then a friendly empty state appears.

### US-1002 — Switch between children
**As a** kid **I want** to pick my own profile **so that** I only see my chores and goals.
**Priority:** Must · **Phase:** P1 · **Reqs:** BRD-02
- Given two children, when I tap my avatar, then the screen filters to my chores and goals.
- Given the board is idle, when the idle timer elapses, then it returns to the household default view.

### US-1003 — Weather at a glance
**As a** parent **I want** the board to show local weather **so that** we dress for the day.
**Priority:** Could · **Phase:** P3 · **Reqs:** BRD-04
- Given a household location is set, when Today loads, then current and daily-high temperature display.
- Given the weather source fails, when Today loads, then the widget hides without affecting other content.

### US-1004 — Configure the board layout
**As an** admin **I want** to choose which panels appear and in what order **so that** the board fits our routine.
**Priority:** Should · **Phase:** P3 · **Reqs:** BRD-05
- Given I disable the Meals panel, when the board refreshes, then it no longer appears.
- Given I reorder panels, when saved, then the board reflects the new order within 3 seconds.

### US-1005 — Come back home automatically
**As a** parent **I want** the board to return to Today after a period of inactivity **so that** it's never left on a random screen.
**Priority:** Must · **Phase:** P1 · **Reqs:** BRD-06
- Given the child is on the Calendar tab, when 60 seconds pass without touch, then the board returns to Today.
- Given a celebration is playing, when idle time elapses, then the return waits until it finishes.

---

## E11 — Points and rewards shop

### US-1101 — Earn points for chores
**As a** kid **I want** to earn points when I finish chores **so that** I can spend them on fun things.
**Priority:** Must · **Phase:** P1 · **Reqs:** PTS-01
- Given a 5-point chore, when I check it off and it is `completed` or `approved`, then exactly one `earn` entry of 5 is posted to the ledger.
- Given the same event is replayed, when processed, then no duplicate entry is created.
- Given the chore is later unchecked, when the status leaves done, then a matching `reversal` of -5 is posted once.
- Given I check off a chore that requires approval, when it is `pending_approval`, then no points are posted until it is approved.

### US-1102 — See my points balance
**As a** kid **I want** to see my points on the board **so that** I know what I can afford.
**Priority:** Must · **Phase:** P1 · **Reqs:** PTS-02
- Given a balance of 35, when I open Today or the Shop, then I see 35 with a recent-earnings list.
- Given a reversal takes points away that were already spent, when the balance goes below zero, then it is shown in neutral wording as points to earn back, not as an error.
- Given the board is offline, when I check off a chore, then the balance shows a clearly marked projected value until sync.

### US-1103 — Build the rewards shop
**As an** admin **I want** to create the inventory of rewards and activities with point costs **so that** my child has things to work toward, like prizes at an arcade.
**Priority:** Must · **Phase:** P1 · **Reqs:** PTS-03
- Given I add "Movie night" at 100 points with an image, when I save, then it appears in the board's Shop within 3 seconds.
- Given I set stock to 1, when it is redeemed, then it shows as unavailable.
- Given I archive an item, when the board refreshes, then it disappears but past redemptions keep their cost snapshot.

### US-1104 — Ask for a reward
**As a** kid **I want** to pick a reward and ask for it **so that** I can use my points.
**Priority:** Must · **Phase:** P1 · **Reqs:** PTS-04
- Given a balance of 120 and an item costing 100, when I tap "Ask for this", then a `requested` redemption is created and the board shows it as pending.
- Given a balance of 120 and one open request for 100, when I ask for another 100 item, then the request is refused (available = 20).
- Given I change my mind before approval, when I cancel, then the request is withdrawn with no ledger entry.

### US-1105 — Approve and fulfill a reward
**As an** admin **I want** to approve a request and mark it fulfilled **so that** the points are spent and the reward actually happens.
**Priority:** Must · **Phase:** P1 · **Reqs:** PTS-04
- Given a requested redemption, when I approve it, then one `spend` entry is posted and the balance drops by the cost snapshot.
- Given I deny it, when the board refreshes, then no points are spent and the child sees a friendly "not this time".
- Given an approved redemption, when I mark it fulfilled, then it moves to history.

### US-1106 — Adjust points manually
**As an** admin **I want** to add or remove points with a reason **so that** I can correct mistakes or give a one-off bonus.
**Priority:** Must · **Phase:** P1 · **Reqs:** PTS-01
- Given I add 10 points with the reason "Helped a neighbor", when I save, then an `adjustment` entry is posted with my identity and it appears in history.
- Given an adjustment, when I look for a way to edit or delete it, then there is none; I post a correcting entry instead.

### US-1107 — Automatic bonus points
**As an** admin **I want** bonus points for streaks or a perfect day **so that** consistency pays off.
**Priority:** Should · **Phase:** P2 · **Reqs:** PTS-05
- Given a rule "7-day good streak = +20", when the streak hits 7, then one `bonus` entry of 20 is posted.
- Given the job reruns, when the streak is unchanged, then no second bonus is posted.

### US-1108 — Wishlist and saving up
**As a** kid **I want** to pin a reward I'm saving for **so that** I can see how far away it is.
**Priority:** Should · **Phase:** P2 · **Reqs:** PTS-06
- Given I pin a 200-point item with a balance of 120, when I open Today, then I see a meter at 60%.
- Given I reach the cost, when the board renders, then it prompts me to ask for it.

# 03 — User Stories

> Version 0.8 · Status: build baseline · Maintained by Claude Code
> v0.8.24: US-503, US-504 and US-507 as built (WP-23, D-65): the board's Calendar (Week, Day, Month; arrows, a swipe or Today), each event in its calendar's color with whose it is, and each board's own choice of calendars on Boards; offline, a range beyond the board's two weeks says it shows what the board has.
> v0.8.23: US-501 and US-505 as built (WP-22, D-63): saving a link syncs it at once and Calendars lists what's coming up, or what's wrong with the link; a calendar that can't sync says what to do, keeps its last good events and is named on System Health.
> v0.8.22: US-104 and US-316: a parent whose sign-in isn't linked links it to themselves in one tap from My tasks, Reminders or their page on Members; a Child record says only an adult can have a sign-in (D-61).
> v0.8.21: US-403, US-404, US-1102, US-1104 and US-1105 as built on the board (WP-20, D-59): goals with a meter per rule, the run now and the best for a streak, and a nudge naming a goal nearly reached, on a child's own screen (there is no separate Goals screen; the family's goals sit under everyone's day); a reached goal celebrated full-screen once; the shop, "Ask for this" with a second tap to be sure, the request pending at once, called off while it waits, and the parent's answer live. Goal progress shows as the server last worked it out.
> v0.8.20: US-317, US-318 and US-319 as built (WP-40, D-58): the Reminders page, the bell in My tasks, an item's lead time in its editor, and the reminders job; a test notification works on the live app once its keys are set.
> v0.8.19: US-1107 and US-1108 as built (WP-30, D-57): bonus rules on the Rewards page, paid by day close from the stored history; the wish card and picker on a child's own screen. Asking for the wish from the board comes with WP-20's shop.
> v0.8.18: US-401, US-405, US-407 and US-406's log (`rules_changed`, then `recomputed` with the progress before and after) as built in the admin app and the database (WP-19, D-56); the preview of a rule change is WP-39; the board's goal meter, nudge and celebration (US-403, US-404) come with WP-20.
> v0.8.17: US-408 as built (WP-17, D-55): Insights for a member over 7, 30 or 90 days, history rebuilt from every check-off, and the board's streak flame.
> v0.8.16: US-205 and US-206 as built (WP-13, D-54): the board keeps its check-offs, snapshot and page through an outage and a reload, says when it is offline or its data is old, and marks points not yet saved.
> v0.8.15: US-1103, US-1104 and US-1105 as built in the admin app, the database and the board's API (WP-18, D-53); the board's shop screen comes with WP-20.
> v0.8.14: US-306, US-307, US-309, US-310 and US-316 as built (WP-12, D-52): the admin Today page with the approval queue, late credit, skips and "Not actually done" with Undo; the approval switch on Home; My tasks with quick add.
> v0.8.13: US-402 and US-408's rules for days and runs as built in the rules engine (WP-15, D-51): today counts as good once everything due is done, and is never a miss. Insights and the board's streak flame come with WP-17, goals with WP-19 and WP-20.
> v0.8.12: US-303, US-304, US-305, US-404 (a chore's celebration), US-905, US-1001 (chores and points; events, meals and the goal meter come with their work packages), US-1002, US-1006 and US-1102 as built on the board (WP-11, D-50): undo is its own button with a second tap, and points a parent took away read "A parent changed your points".
> v0.8.11: US-1101, US-1106 and US-1109 as built (WP-16, D-49): earns and reversals follow each item's status, a parent adds or takes away points on the member's page, and a double tap posts once. US-1102's balance and latest entries are on the board's snapshot; the board draws them with WP-11.
> v0.8.10: US-320 everyone does their own (WP-43, D-47).
> v0.8.9: US-304, US-305 and US-307 as built in the database and API (WP-10, D-46); the board's screen comes with WP-11.
> v0.8.8: US-301, US-302, US-308 and US-311 as built (WP-09, D-45): two weeks planned on save, an edit reaches today only where nothing has happened, and each day's snapshot of who was responsible.
> v0.8.7: US-601 and US-602 as built (WP-21, D-44): next year's default calendar, and a child at another school.
> v0.8.6: US-301, US-313 and US-315 as built (WP-08, D-43): save and add another; the day's parts; only an item's creator changes who sees it.
> v0.8.5: US-904 and US-909: System Health shows a household only its own errors, and usage against the Free-plan limits (WP-42, D-42).
> v0.8.4: US-204: the 3-second budget is measured on every pull request, and a board an admin holds on Day or Evening switches live (WP-06, D-41). US-911: our own household may start in production before launch.
> v0.8.3: US-201 and US-202: 8-digit codes on the board's keypad, a board that signs itself in again, and disconnecting for good (WP-05, D-40).
> v0.8.2: US-104 covers the earns-rewards default, linking an adult to their sign-in, and restoring an archived member (WP-04).
> v0.8.1: onboarding is by setup code and invite link, with no public sign-up (US-101, US-102, US-103; D-39).
> v0.8: US-911 follows the delivery loop: you preview as the demo family and approve before anything merges (D-37); US-903 and US-909 for one database.
> v0.7: reminders, switchable per person, device and item (US-317, US-318, US-319; D-35).
> v0.6: one family list (D-30..D-34): shared items with who-did-it credit (US-311), household tags (US-312), due times (US-313), overdue tasks carry over (US-314), private items (US-315), My tasks (US-316), Family view (US-1006), earns-rewards switch (US-1109); US-301, US-303, US-304, US-307, US-401, US-1002, US-1101 updated.
> v0.5: free plans (D-29): backups (US-903), cost and pausing (US-909) and previews (US-911) updated.
> v0.4: magic link + password sign-in (US-102) with Apple/passkey later (US-106); event-time conflicts (US-205); today-only board and parent-only late credit (US-303, US-307); approval switch and day-close rules (US-310, US-307); closures spare today (US-602); delivery pipeline (US-911).
> Each story lists its `Reqs:` (defined in `04-requirements-traceability.md`). Acceptance criteria are Given/When/Then and are the basis for Playwright, Vitest, and pgTAP test names (prefix tests with the story or requirement ID, e.g. `[US-304][CHR-04]`).

## Personas

| ID | Persona | Description |
|---|---|---|
| **Kid** | Child | Uses the 32" 4K touch board. One child in v1 (schema supports more). Icon-first UI. Never signs in. |
| **Admin** | Parent | Manages everything from phone/laptop, including their own tasks. Two admins in v1. |
| **Family** | Everyone at the board | Sees who is doing what today and checks items off for anyone. |
| **Board** | Device | The paired kiosk; it is only the interactive front end and acts on behalf of the household, not a person. |
| **System** | Platform | Scheduled jobs and derived-data maintenance. |

Priority uses MoSCoW. Phases: **P0** foundation · **P1** kid loop and rewards (built as P1a–P1d) · **P2** meals, menu and extras · **P3** polish. Nothing goes live until every phase is built (D-19).

---

## E1 — Household and access

### US-101 — Create the household
**As an** admin **I want** to create my household with a name and timezone **so that** all dates, schedules, and day boundaries are correct.
**Priority:** Must · **Phase:** P0 · **Reqs:** ACC-01, NFR-09
- Given I hold a setup code from the setup-code workflow, when I enter it with a household name, timezone `America/Detroit` and week start, then the household and its settings exist with me as owner, and every later record I create carries that `household_id`.
- Given a setup code was already used or is older than 24 hours, when I enter it, then it is refused and nothing is created.
- Given a second household exists, when I query as a member of the first, then I see zero rows from the second.

### US-102 — Sign in securely
**As an** admin **I want** to sign in with an emailed magic link or with my email and password **so that** only parents can manage the board.
**Priority:** Must · **Phase:** P0 · **Reqs:** ACC-02, NFR-04
- Given I enter my email and choose "Email me a link", when I open the link before it expires, then I land on `/admin` for my household.
- Given I have set a password, when I sign in with my email and password, then I land on `/admin` for my household; a wrong password shows a neutral error and does not reveal whether the email exists.
- Given I forgot my password, when I request a reset, then I receive a reset link and can set a new password.
- Given I am not signed in, when I request any `/admin` route, then I am redirected to sign-in.
- Given I have no account, when I look for a way to sign up, then there is none: accounts come from a setup code or an invite (D-39).
- Given a paired board session, when it calls an admin route, then it receives 403.

### US-103 — Invite my spouse
**As an** admin **I want** to invite another parent by email **so that** we can both manage the board.
**Priority:** Must · **Phase:** P0 · **Reqs:** ACC-03
- Given I enter their email, when I create the invite, then I get a link to copy or share that works once, for 7 days.
- Given the recipient opens the link before expiry and signs in with that email, or is new and chooses a password, when they join, then they become an admin of my household.
- Given an invite is expired, cancelled or already used, or the signed-in account has another email, when it is opened, then it is refused and I can create a new one.

### US-104 — Manage family members
**As an** admin **I want** to add children and adults with a name, avatar, and color **so that** chores, goals, and meals can be assigned per person.
**Priority:** Must · **Phase:** P0 · **Reqs:** ACC-04
- Given I add a child, when I save, then they appear on the board's child selector without any login being created.
- Given I archive a child, when the board refreshes, then their active chores and goals no longer display but history is retained; I can restore them later.
- Given I add a child, the earns-rewards switch starts on; for an adult it starts off; I can change it for anyone (PTS-07).
- Given an adult in the family is an admin, when I link their member to their sign-in, then it is saved; a sign-in that is not an admin of my household cannot be linked, and each sign-in links to one member.
- Given my own record says Child, when I open it, then it says only an adult can have a sign-in and to choose Adult; once it says Adult, "This is me" links my sign-in to it, moving it off an archived record if it was there (D-61).

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
- Given I name a board in admin and get its 8-digit code, when it is typed on the board's keypad within 10 minutes, then the board receives a device session and loads the household's data.
- Given a code was already used or expired, when it is submitted, then it is rejected; after 20 wrong codes in 10 minutes, pairing pauses.
- Given a paired board loses its session (a lost refresh, cleared cookies), when it next loads, then it signs itself in again without anyone at the screen.
- Given a paired board, when it attempts to write anything other than completions, then the request is denied.

### US-202 — Manage and revoke devices
**As an** admin **I want** to see, rename, and revoke paired devices **so that** a lost or retired display can't access my family's data.
**Priority:** Must · **Phase:** P0 · **Reqs:** DEV-03, DEV-02
- Given a device is listed, when I view it, then I see name, status, and last-seen time.
- Given I revoke a device, when it next queries or its realtime channel receives data, then access is denied immediately and it returns to the pairing screen; it cannot sign in again and is paired anew as a new board.

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
- Given I rename a family member in admin, when I save, then the paired board shows the new name within 3 seconds (p95, measured by e2e on every pull request).
- Given I hold a board on Day or Evening in Boards, when I save, then the board switches at once; set back to automatic, it follows household time (Day from 6:30 am to 7:00 pm).

### US-205 — Keep working offline
**As a** parent **I want** the board to keep working when wifi drops **so that** the habit doesn't break.
**Priority:** Must · **Phase:** P1 · **Reqs:** DEV-06, NFR-01
- Given wifi is off, when the child checks off chores, then the UI updates instantly, the events are queued, the board says "Offline: your check-offs are saved", and a balance that counts them shows as not saved yet.
- Given the board reloads while wifi is off, when it opens, then it shows its last day with the queued check-offs still done.
- Given wifi returns, when the outbox replays, then each event is applied exactly once and the board shows server-authoritative state.
- Given the board has been offline for 24 hours, when it is opened, then it displays the last cached day's data with a stale indicator.
- Given the child checked off a chore offline at 7:00 and a parent unchecked it on the phone at 7:30, when the board's 7:00 event replays at 8:00, then the chore stays open because the later event by time wins.
- Given the board's clock runs ahead, when its events reach the server, then their time is capped at the time the server received them.

### US-206 — Know when data is stale
**As a** parent **I want** a subtle indicator when the board's data is old **so that** I know when not to trust it.
**Priority:** Should · **Phase:** P1 · **Reqs:** DEV-08
- Given the last snapshot is older than 5 minutes or realtime is disconnected, when the board renders, then a discreet stale icon appears ("Updated 12 minutes ago"; Realtime's own state reads "Reconnecting…").
- Given planning or day closing is late or erroring for the household, when the board renders, then it says today's list may be out of date.
- Given a calendar source's last success is older than three sync intervals, when the calendar view renders, then it shows a "calendar may be out of date" badge.

### US-207 — Quiet hours and burn-in protection
**As an** admin **I want** the display to dim or sleep overnight and avoid static pixels **so that** it's not a night light and the panel lasts.
**Priority:** Should · **Phase:** P3 · **Reqs:** DEV-07
- Given quiet hours 21:00–06:30, when the time is reached, then the board dims to a minimal clock layout (or powers the screen down on the Pi) and touch wakes it.
- Given the board is idle, when more than 10 minutes pass, then the layout drifts or dims to avoid static high-contrast elements.

---

## E3 — Chores and tasks

### US-301 — Create a chore or task
**As an** admin **I want** to create chores (routines) and tasks (to-dos) with an icon, assignees from the whole family, points, tags, an optional due time, and optional approval **so that** everyone's responsibilities live in one list.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-01
- Given I save a chore with a title, icon, and one assignee, when I view the list, then it appears with when it is next due, and occurrences exist for today and the next 14 days where scheduled; its page lists them under "Coming up".
- Given I save an item assigned only to an adult who does not earn rewards, when it is completed, then no points are posted, whatever its points value.
- Given I choose Task and a due date, when I save, then it behaves as a to-do that stays open until done (US-314).
- Given I set "requires approval", when the child completes it, then its state is `pending_approval`.
- Given I'm entering the family's list on my phone, when I choose "Save and add another", then the form comes back empty for the next item of the same kind, and six chores and two tasks take under five minutes.

### US-302 — Schedule chores around the school year
**As an** admin **I want** chores to recur on chosen days and only on certain day types **so that** school-day routines differ from weekends and summer.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-02, SCH-03
- Given a chore scheduled weekdays with day type `school_day`, when a weekday falls inside a break, then no occurrence is generated for that date.
- Given a one-off task with `on_date`, when that date arrives, then exactly one occurrence exists.
- Given a one-off task entered after its date, when I save it, then it is open on its date and the list shows it as overdue since then.
- Given "the 31st" every month, when a month is shorter, then it falls on that month's last day (D-45).

### US-303 — See my chores for today
**As a** kid **I want** to see today's chores as big pictures **so that** I know what to do without help.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-03, BRD-01, CHR-12
- Given today has three scheduled chores for me, when I open the board, then I see exactly those three with icons and my progress for the day.
- Given a chore isn't scheduled today, when I open the board, then it is not shown.
- Given yesterday had an unfinished routine, when I open the board, then only today's items and my open overdue tasks appear; catching up a past day's routine is done by a parent.

### US-304 — Check off a chore
**As a** kid **I want** to tap a chore to mark it done **so that** I get credit and see my progress grow.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-04, CHR-09
- Given a scheduled chore, when I tap it, then it shows complete within 100 ms and a completion event is recorded exactly once.
- Given I double-tap rapidly, when events reach the server, then only one effective completion exists (idempotent).
- Given the chore does not require approval (the default), when I check it off, then its status becomes `completed` immediately and points are earned; a parent verifies in real life afterwards.
- Given the chore is shared with someone else, when I check it off on my own screen, then I am recorded as the one who did it.
- Given the board sends the same check-off again (a retry, or an offline replay), when it is recorded, then nothing new is recorded and the board gets the current state (WP-10).

### US-305 — Undo an accidental tap
**As a** kid **I want** to undo a mistaken tap right away **so that** I'm not credited for something I didn't do.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-04
- Given I completed a chore less than the undo window ago (default 2 minutes), when I tap Undo under it and tap again to confirm, then it returns to `scheduled` via a compensating `undo` event and its points come back off my balance.
- Given I tap Undo once, when I don't tap again within 4 seconds, then nothing changes.
- Given the undo window has passed, when I look, then there is no Undo button; an admin can undo it. The window is judged by when each tap happened, so an offline board's undo is judged as it happened (D-46).

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
- Given a routine is still `scheduled` or `rejected` when the household-local day ends, when the day-close job runs, then its `status` becomes `missed`, `finalized_at` is set, and the day's `member_daily_summary` row is written.
- Given the day-close job runs twice, when it finishes, then the result is identical (idempotent).
- Given a missed occurrence, when a parent completes it late, then it folds to `approved`, points are earned, and the day's history is re-derived.
- Given the board was offline across midnight, when a check-off whose time falls outside the chore's due date replays, then it is stored as flagged and waits for a parent as `pending_approval`.

### US-309 — Uncheck a batch of chores
**As an** admin **I want** to select several chores my child checked off but did not actually do and uncheck them together **so that** points and progress stay honest without tedious one-by-one edits.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-08, CHR-06, PTS-01
- Given 5 occurrences are `completed`, when I select 4 and choose "Not actually done", then 4 `admin_uncomplete` events are written with one shared `batch_id` and they return to `scheduled` (or `missed` if the day is closed).
- Given those occurrences had earned points, when the batch is applied, then matching reversal entries are posted to the points ledger exactly once.
- Given the batch is applied, when the board refreshes, then the child sees the chores open again without a punitive message.
- Given I unchecked a batch by mistake, when I tap Undo, then each item not changed since is done again by whoever had done it, and its points are earned again (D-52).

### US-308 — Edit a chore without rewriting history
**As an** admin **I want** edits to a chore to affect only future occurrences **so that** past credit and streaks stay intact.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-03
- Given a chore with past completions, when I change its title and schedule, then past occurrences and their completions are unchanged and future `scheduled` occurrences are regenerated.
- Given I change points, when I view a past occurrence, then it shows its original `points_snapshot`.
- Given I change or archive an item in the morning, when nobody has checked off today's yet, then today's follows the change (or leaves the board, so it is never missed); one already checked off stays as it was (D-45).
- Given a closure is added for today, when the board shows today, then today is as it was planned; later days follow the closure (D-24).

### US-311 — Share one item between several people
**As an** admin **I want** to assign one chore or task to several family members **so that** shared work appears once and whoever does it gets the credit.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-09, CHR-03
- Given "Feed the dog" is assigned to Sam and Dad, when the day's items are generated, then there is one occurrence for the day, shown under both of them.
- Given Sam checks it off on Sam's screen, when it is saved, then it is done for both, Sam is recorded as having done it, and it counts as covered (neither done nor missed) for Dad.
- Given it was done together, when the person checking it off picks Sam and Dad, then both are recorded and each one who earns rewards gets the item's points.
- Given nobody does a shared routine, when the day closes, then it is missed for every assignee.
- Given I later change the assignees, when I view past days, then they still show who was responsible on each day.
- Given I add Leo to "Feed the dog" at 7 am, when nobody has done today's yet, then today's is Leo's too, the same occurrence on everyone's screen (D-45).

### US-320 — Everyone does their own
**As an** admin **I want** a chore for several children to be each child's own **so that** each makes their own bed and gets their own credit, and a miss counts only for the one who missed it.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-18, CHR-09
- Given I assign "Make bed" to Maya and Leo, when I save it as a chore, then "Everyone does their own" is chosen and each of them has their own "Make bed" every day.
- Given Maya makes her bed and Leo does not, when the day closes, then Maya's is done and Leo's is missed.
- Given Leo's school is on break and Maya's is not, when a school-days-only chore is planned for both, then only Maya has it on those days.
- Given "Feed the dog" for Maya and Alex, when I choose "Any one of them", then there is one each day, done by whoever gets to it (US-311).
- Given I switch an item between the two, when I save, then today follows unless someone already checked off today's, and past days keep what they were.

### US-312 — Define household tags
**As an** admin **I want** to define our own tags with a name, color, and icon **so that** we can filter the list and set measurable goals by category.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-10, RWD-02
- Given I create the tag "Kitchen" and apply it to three chores, when I filter by Kitchen, then exactly those three appear.
- Given a goal counts chores tagged Kitchen, when I rename the tag to "Kitchen & dishes", then the goal counts the same chores and its progress is unchanged.
- Given I archive a tag, when I edit items, then it is no longer offered, but goals and history that use it keep working.

### US-313 — Give an item a due time
**As an** admin **I want** to set an optional due time **so that** the day is ordered into morning, after school, and evening.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-11
- Given "Make bed" is due at 7:30 and "Homework" at 16:00, when the board shows today, then "Make bed" is under Morning and "Homework" under After school; items without a time appear under Anytime.
- Given it is 7:45 and "Make bed" is open, when the board renders, then the item is marked as past its time in a calm style, never red.
- Given "Make bed" is done at 8:05, when the day closes, then it is done, not missed; the due time does not change scoring.
- Given due times, when the day is grouped, then Morning is before noon, After school from noon, and Evening from 5 pm.

### US-314 — Overdue tasks carry over
**As a** parent **I want** a task that wasn't done by its due date to stay on the list **so that** to-dos are not lost at midnight.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-12, CHR-07
- Given the task "Call the plumber" was due yesterday and is still open, when the day closes, then it stays open and shows as overdue, not missed.
- Given an overdue task, when an assignee completes it, then it is done, recorded as late, and any points are earned on the day it was done.
- Given the routine "Make bed" was not done yesterday, when the day closes, then it is missed; only tasks carry over.
- Given the repeating task "Pay the card bill" is still overdue when the next one is generated, when I view the list, then both appear until each is done or cancelled.

### US-315 — Keep an item private
**As an** admin **I want** to mark an item private **so that** surprises and personal items stay off the board and away from the other parent.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-13
- Given I create a private task "Buy anniversary gift" assigned to me, when the board or my spouse's account loads, then the item, its occurrences, and its audit history are not returned.
- Given a private task is assigned to my spouse, when my spouse signs in, then they see it because they are responsible for it.
- Given an item is family-visible (the default), when anyone opens the board, then it appears under its assignees.
- Given my spouse created an item, when I edit it, then I can't change who sees it; only its creator can (D-43).

### US-316 — My tasks on my phone
**As a** parent **I want** a My tasks view on my phone **so that** I can run my own day from the same family list.
**Priority:** Must · **Phase:** P1 · **Reqs:** CHR-14, CHR-09
- Given items are assigned to me, when I open My tasks, then I see overdue, today's, and upcoming items in that order, including shared items I am on.
- Given I type a title in quick add, when I save, then a family-visible task due today and assigned to me exists in one step, with no points, and it is on the board at once.
- Given my sign-in isn't linked to a member, when I open My tasks or Reminders, then it asks which one is me among the adults with no sign-in, and one tap links it; if I'm not listed, it says how to fix my record or add myself (D-61).
- Given I complete an item on my phone, when the board refreshes, then it shows as done by me.

### US-317 — Turn reminders on or off for myself
**As a** parent **I want** to turn reminders on or off for myself and choose which devices get them **so that** I'm nudged only where and when I want.
**Priority:** Must · **Phase:** P2 · **Reqs:** CHR-15
- Given reminders are off (the default), when an item of mine comes due, then I get no notification.
- Given I tap "Turn on reminders" in the admin app on my iPhone's Home Screen and allow notifications, when I send a test, then it arrives on that phone.
- Given reminders are on for my phone and laptop, when I remove the laptop in Settings, then only the phone receives them.
- Given I turn reminders off, when anything comes due, then no device of mine is notified until I turn them back on.

### US-318 — Choose which items remind me
**As a** parent **I want** a bell on each item and a default for new ones **so that** only the things I care about interrupt me.
**Priority:** Must · **Phase:** P2 · **Reqs:** CHR-16
- Given my default is "remind me", when I'm assigned a new item, then its bell is on for me, and I can turn it off for that item only.
- Given "Call the plumber" is due at 15:00 with a 15-minute lead, when it is 14:45 and the task is open, then I get exactly one notification, and tapping it opens the item in My tasks.
- Given I complete the item at 14:30, when 14:45 arrives, then no notification is sent.
- Given an item has no due time, when its due date arrives, then I'm reminded at my morning time.
- Given a shared item, when it comes due, then each assignee with reminders on is notified, and nobody is notified after someone completes it.

### US-319 — Morning digest, quiet hours, and discreet notifications
**As a** parent **I want** an optional morning summary, quiet hours, and discreet notifications for private items **so that** reminders help without disturbing anyone or spoiling surprises.
**Priority:** Must · **Phase:** P2 · **Reqs:** CHR-17
- Given I turn on the digest at 7:00, when it is 7:00, then I get one notification summarizing my overdue and today's items, and none on days with nothing due.
- Given quiet hours of 21:00 to 7:00, when a reminder falls inside them, then it is held until 7:00 and sent once.
- Given a private item reminds me, when the notification shows on my lock screen, then it reads "Private task due at 15:00" without the title.

---

## E4 — Rewards

### US-401 — Create a reward goal
**As an** admin **I want** to define a reward with start and end dates and rules **so that** my child works toward something specific.
**Priority:** Must · **Phase:** P1 · **Reqs:** RWD-01, RWD-02, RWD-03
- Given I create a goal "Movie night" with a 14-day window and rules (COUNT ≥ 20 chores tagged Morning) AND (STREAK ≥ 5), when I save, then its status is `scheduled` or `active` depending on the start date.
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
- Given my child's run of good days, when the board shows them, then a flame and the count sit beside their name, today included once today is done, bigger at 3, 7, 14 and 30 days.
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
- Given I add a calendar or replace its link, when I save, then it syncs at once and Calendars shows what's coming up, or what's wrong with the link; the link is never shown again (D-63).

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
- Given the board is offline, when I open dates beyond the two weeks it holds, then it shows what it has and says so (D-65).

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
- Given a calendar can't sync, when I open System Health, then it names that calendar; the background job itself still shows as running (D-63).

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
- Given I add next year's calendar, when I view settings, then multiple years coexist and each shows whether it is a default.
- Given next year's calendar is added as a default during the summer, when its first day comes, then everyone follows it with nothing to switch; two default years may not overlap (D-44).
- Given a child goes to another school, when I add that school's year and tick the child under "Who follows it", then their day types follow that calendar while everyone else follows the default.

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
- Given the nightly encrypted backup ran, when I follow the restore runbook in a drill, then the database is recovered into a throwaway database as of that night.
- Given the runbook, when read, then it states RPO/RTO and steps to re-pair the board.

### US-904 — Know when something breaks
**As an** admin **I want** errors and job health visible **so that** I find problems before the family does.
**Priority:** Should · **Phase:** P1 · **Reqs:** NFR-07
- Given any job fails, when I open System Health, then I see job, time, and message.
- Given an unhandled server error, when it occurs, then it is logged with request ID and no PII.
- Given a job failed and then ran well, when I open System Health, then it shows the job as fine again.
- Given another household's errors and jobs, when I open System Health, then I see none of them.

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
- Given the project is on Supabase Free, when a week passes with no family use, then it is not paused because the keepalive writes a heartbeat several times a day.
- Given a keepalive run fails, when it fails, then I receive an email and the runbook shows how to restore the project, while the board keeps showing cached data.
- Given usage, when it approaches a Free-plan limit (80 %), then a warning appears in System Health, with the Vercel account's total and FamilyWise's share, and when the reading was taken.
- Given the cost ceiling, when I review it, then the recurring cost is zero and any paid upgrade is a documented decision.

---

### US-911 — Changes ship through one safe pipeline
**As an** admin **I want** every change to pass automated checks and a preview before it reaches production **so that** a mistake never breaks the family's board.
**Priority:** Must · **Phase:** P0 · **Reqs:** NFR-14, NFR-12
- Given a pull request, when it is opened, then lint, typecheck, unit tests, database tests, traceability and build run without Docker, and the PR cannot merge until they pass.
- Given a pull request, when Vercel finishes its preview, then the PR's new migrations are applied (unless one removes or renames something), the demo family is reset, and the e2e suite runs against the preview; two PRs never test at the same time.
- Given a pull request with every check green, when I open its preview, then I see the demo family, and nothing I do there changes my family's data.
- Given a pull request, when I have not approved it, then it is not merged or deployed.
- Given a merge to `main`, when the deploy runs, then migrations are applied to production before the app is deployed, and a failed migration stops the app deploy.
- Given production before launch, when I look at it, then it holds only the demo family and any household I started with a setup code (ours may start early); a preview's demo reset never touches a household with a real admin.

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

### US-1002 — Switch between family members
**As a** kid **I want** to pick my own profile **so that** I only see my items and goals.
**Priority:** Must · **Phase:** P1 · **Reqs:** BRD-02
- Given several family members, when I tap my avatar, then the screen filters to my items, and to my points and goals if I earn rewards.
- Given the board is idle, when the idle timer elapses (90 seconds untouched), then it returns to the household default view: everyone's day.

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

### US-1006 — See the whole family's day
**As a** family **we want** a Family view on the board **so that** everyone can see who is doing what today.
**Priority:** Must · **Phase:** P1 · **Reqs:** BRD-07, CHR-04
- Given each member has family-visible items today, when I open the Family view, then I see a column per person grouped by part of day, with overdue tasks first.
- Given I tap an item with several assignees, when the who-did-it picker appears, then the assignees are listed first and I can pick anyone in the family, or several people.
- Given an adult who does not earn rewards checks off an item, when it saves, then no points or celebration appear; a child's item still celebrates.
- Given an item is private, when the Family view loads, then it is not shown.

---

## E11 — Points and rewards shop

### US-1101 — Earn points for chores
**As a** kid **I want** to earn points when I finish chores **so that** I can spend them on fun things.
**Priority:** Must · **Phase:** P1 · **Reqs:** PTS-01
- Given a 5-point chore, when I check it off and it is `completed` or `approved`, then exactly one `earn` entry of 5 is posted to the ledger.
- Given the same event is replayed, when processed, then no duplicate entry is created.
- Given the chore is later unchecked, when the status leaves done, then a matching `reversal` of -5 is posted once.
- Given I check off a chore that requires approval, when it is `pending_approval`, then no points are posted until it is approved.
- Given my sister and I did a shared 5-point chore together, when it is checked off for both of us, then each of us earns 5 points once.

### US-1102 — See my points balance
**As a** kid **I want** to see my points on the board **so that** I know what I can afford.
**Priority:** Must · **Phase:** P1 · **Reqs:** PTS-02
- Given a balance of 35, when I open Today or the Shop, then I see 35 with a recent-earnings list.
- Given a parent took points away with a reason, when I see my list on the board, then it says "A parent changed your points" and not the reason, which stays in the admin app (D-50).
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
- Given two boards send a request for me at the same moment and I can afford only one, when they are recorded, then exactly one is accepted (D-53).

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
- Given I tap "Add points" twice, when the form is sent again, then the points are added once.
- Given a member who doesn't earn rewards, when I open their page, then there is no way to give them points.

### US-1107 — Automatic bonus points
**As an** admin **I want** bonus points for streaks or a perfect day **so that** consistency pays off.
**Priority:** Should · **Phase:** P2 · **Reqs:** PTS-05
- Given a rule "7-day good streak = +20", when the streak hits 7, then one `bonus` entry of 20 is posted.
- Given the job reruns, when the streak is unchanged, then no second bonus is posted.
- Given a run already paid, when it goes on to 8 days, then nothing more is paid; when a new run reaches 7, it pays again.
- Given a rule "a perfect day = +5", when a child's day is good, then one bonus of 5 is posted for that day.
- Given I turn a rule off and later back on, when bonuses are paid, then the days while it was off never pay; given I archive it, then the bonuses it paid stay.

### US-1108 — Wishlist and saving up
**As a** kid **I want** to pin a reward I'm saving for **so that** I can see how far away it is.
**Priority:** Should · **Phase:** P2 · **Reqs:** PTS-06
- Given I pin a 200-point item with a balance of 120, when I open Today, then I see a meter at 60%.
- Given I reach the cost, when the board renders, then it prompts me to ask for it.
- Given the board is offline, when I want to choose or change my wish, then it tells me that needs the internet, and still shows my wish.
- Given the reward I pinned leaves the shop, when the board renders, then it shows no wish until I choose again (or the reward returns).

### US-1109 — Choose who earns rewards
**As an** admin **I want** an earns-rewards switch on each family member **so that** points, approval, and goals apply only to the people we choose.
**Priority:** Must · **Phase:** P1 · **Reqs:** PTS-07
- Given I add a child, when I save, then earns rewards is on; given I add an adult, then it is off.
- Given Dad has earns rewards off, when he completes a 5-point chore, then no ledger entry is posted and no approval is needed.
- Given I turn earns rewards on for an adult for a family challenge, when they complete chores, then they earn points and can have goals.
- Given I turn the switch off, when I view past history, then points already earned stay in the ledger.

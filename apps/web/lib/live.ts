/**
 * [DEV-05] Notify, then refetch (01 §7). Realtime only says that a board-readable row changed; the
 * board then reads its whole snapshot again. These are the pieces that do not need a browser.
 */

export interface BoardTable {
  table: string;
  filter: string;
}

/**
 * The board-readable tables, each filtered to this board's household (or to the board itself).
 * They are the supabase_realtime publication, which 070_board_snapshot.test.sql pins: a work
 * package that publishes a new table adds it here too.
 */
export function boardTables(householdId: string, deviceId: string): BoardTable[] {
  return [
    { table: 'household', filter: `id=eq.${householdId}` },
    { table: 'household_settings', filter: `household_id=eq.${householdId}` },
    { table: 'member', filter: `household_id=eq.${householdId}` },
    { table: 'device', filter: `id=eq.${deviceId}` },
    { table: 'points_ledger', filter: `household_id=eq.${householdId}` },
    { table: 'chore_occurrence', filter: `household_id=eq.${householdId}` },
    { table: 'chore', filter: `household_id=eq.${householdId}` },
    { table: 'streak_segment', filter: `household_id=eq.${householdId}` },
    { table: 'wishlist_pin', filter: `household_id=eq.${householdId}` },
    // The shop, requests and goals (WP-20).
    { table: 'reward_catalog_item', filter: `household_id=eq.${householdId}` },
    { table: 'redemption', filter: `household_id=eq.${householdId}` },
    { table: 'reward_goal', filter: `household_id=eq.${householdId}` },
    { table: 'reward_goal_progress', filter: `household_id=eq.${householdId}` },
    { table: 'reward_rule_progress', filter: `household_id=eq.${householdId}` },
    // The calendars (WP-23): a sync updates its calendar's row last; a board's own choice; a
    // calendar's people (WP-50), for a person removed for good.
    { table: 'calendar_source', filter: `household_id=eq.${householdId}` },
    { table: 'calendar_member', filter: `household_id=eq.${householdId}` },
    { table: 'device_calendar', filter: `device_id=eq.${deviceId}` },
    // The weather (WP-45): each read, or a read failing.
    { table: 'weather_reading', filter: `household_id=eq.${householdId}` },
    // Meals (WP-28): the plan and its library, school lunch, and the schools' menus.
    { table: 'meal', filter: `household_id=eq.${householdId}` },
    { table: 'meal_plan_entry', filter: `household_id=eq.${householdId}` },
    { table: 'member_lunch', filter: `household_id=eq.${householdId}` },
    { table: 'lunch_override', filter: `household_id=eq.${householdId}` },
    { table: 'school_menu_day', filter: `household_id=eq.${householdId}` },
    // Lunches picked on the board (WP-49): a child's changes and a day's picks.
    { table: 'lunch_request', filter: `household_id=eq.${householdId}` },
    { table: 'lunch_choice', filter: `household_id=eq.${householdId}` },
  ];
}

/**
 * Wraps a read so that calls made while one is in flight cost one more read, not one each: a burst
 * of changes means at most two reads, and the last read always starts after the last change.
 * `load` handles its own errors; one that throws anyway does not stop later reads.
 */
export function coalesce(load: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return function run() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await load().catch(() => undefined);
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };
}

/**
 * [CAL-05][WP-70] How long a snapshot read may be out before another starts beside it. The first is
 * not given up: on a slow database it may still be the first back.
 */
export const READ_DEADLINE_MS = 4_000;
/** [CAL-05][WP-70] Reads made for one change, at most, before the board waits for the next. */
export const READ_TRIES = 3;

/**
 * [CAL-05][WP-70] A board's read after a change, made again when it fails or doesn't come back.
 * `read` gets a signal (aborted once the result is known) and says whether it read (false for an
 * error). One that fails or throws is made again at once; one still out after `deadlineMs` gets
 * another beside it, and the first to read wins. At most `tries` reads; when the last has been out
 * `2 × deadlineMs`, or every read has failed, it resolves false and all are aborted. Before WP-70 a
 * failed read was dropped and a hung one blocked every later read, so the board kept a change it
 * had heard off the screen until DEV-08's four-minute read.
 */
export function readSoon(
  read: (signal: AbortSignal) => Promise<boolean>,
  { deadlineMs = READ_DEADLINE_MS, tries = READ_TRIES } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const reads: AbortController[] = [];
    let failed = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const r of reads) r.abort();
      resolve(ok);
    };
    const start = () => {
      if (done) return;
      if (reads.length >= tries) return finish(false);
      const r = new AbortController();
      reads.push(r);
      clearTimeout(timer);
      // Still out at the deadline: another beside it (the last gets twice as long, then gives up).
      timer = setTimeout(start, reads.length < tries ? deadlineMs : 2 * deadlineMs);
      void read(r.signal)
        .catch(() => false)
        .then((ok) => {
          if (done) return;
          if (ok) return finish(true);
          failed += 1;
          // Every read made so far has failed: the next at once, or give up after the last.
          if (failed === reads.length) start();
        });
    };
    start();
  });
}

/** Milliseconds until the next minute starts, so a clock ticks on the minute. */
export function untilNextMinute(now: Date): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}

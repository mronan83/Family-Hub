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
    // The calendars (WP-23): a sync updates its calendar's row last; a board's own choice.
    { table: 'calendar_source', filter: `household_id=eq.${householdId}` },
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
 * [CAL-05][WP-70] How long one snapshot read may be out. One still out then is given up (its request
 * aborted) and made again, so a read that never comes back can't hold back the changes heard after it.
 */
export const READ_DEADLINE_MS = 4_000;
/** [CAL-05][WP-70] Reads made for one change, at most, before the board waits for the next. */
export const READ_TRIES = 3;

/**
 * [CAL-05][WP-70] A board's read after a change, made again when it doesn't come back. `read` gets a
 * signal that aborts at the deadline, and says whether it read (false for an error). One that fails,
 * throws or is still out at the deadline is made again at once, up to `tries` reads in all; resolves
 * whether one read. Before WP-70 a failed read was dropped and a hung one blocked every later read,
 * so the board kept a change it had heard off the screen until DEV-08's four-minute read.
 */
export async function readSoon(
  read: (signal: AbortSignal) => Promise<boolean>,
  { deadlineMs = READ_DEADLINE_MS, tries = READ_TRIES } = {},
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        abort.abort();
        resolve(false);
      }, deadlineMs);
    });
    const ok = await Promise.race([read(abort.signal).catch(() => false), late]);
    clearTimeout(timer);
    if (ok) return true;
  }
  return false;
}

/** Milliseconds until the next minute starts, so a clock ticks on the minute. */
export function untilNextMinute(now: Date): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}

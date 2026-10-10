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

/** Milliseconds until the next minute starts, so a clock ticks on the minute. */
export function untilNextMinute(now: Date): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}

/**
 * [DEV-05] Notify, then refetch (01 §7). The database says that a board-readable row changed; the
 * board then reads its whole snapshot again. These are the pieces that do not need a browser.
 */

/**
 * [DEV-05][WP-126] A board's own private Realtime topic (D-159). The database sends one message to
 * it, event `change` with only the table's name, for each statement that changes a board-readable
 * row the board may see: its household's rows, or the board's own (`private.board_notify()`,
 * 680_board_broadcast.test.sql). Only an active board may join its topic (Realtime authorization),
 * and the database sends only to active boards, so a disconnected board hears nothing at once.
 */
export function boardTopic(deviceId: string): string {
  return `board:${deviceId}`;
}

/** [DEV-05][WP-126] The Broadcast event the database sends a board for a change. */
export const BOARD_EVENT = 'change';

/** The part of a Supabase client `listen()` uses, so a test can stand in for it. */
export interface Live<C extends LiveChannel> {
  channel(topic: string, options: { config: { private: true } }): C;
  realtime: { setAuth(token?: string | null): Promise<void> | void };
}
export interface LiveChannel {
  on(type: 'broadcast', filter: { event: string }, callback: () => void): LiveChannel;
  subscribe(callback: (status: string) => void): unknown;
}

/**
 * [DEV-05][WP-126] Joins the board's private topic with its token (Realtime checks the board's
 * right to it on joining), calls `heard` for each change sent to it, and `status` with each of the
 * channel's states (SUBSCRIBED when joined; the board reads again then, to catch up).
 */
export async function listen<C extends LiveChannel>(
  db: Live<C>,
  channel: C,
  token: string | null,
  heard: () => void,
  status: (state: string) => void,
): Promise<void> {
  if (token) await db.realtime.setAuth(token);
  channel.on('broadcast', { event: BOARD_EVENT }, () => heard());
  channel.subscribe(status);
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
 * [CAL-05][DEV-05][WP-126] How long a board's read may be out before the board counts it lost and
 * makes another: the database's statement timeout for a board (the `authenticated` role, 8 s on both
 * projects, `scripts/db-health.sh`) and 2 s more. By then the database has ended the read itself
 * (answered, or cancelled it at its timeout), so a read made then never runs beside it (D-159).
 */
export const READ_DEADLINE_MS = 10_000;
/** [CAL-05][WP-70] Reads made for one change, at most, before the board waits for the next. */
export const READ_TRIES = 3;

/**
 * [CAL-05][WP-70][WP-126] A board's read after a change, made again when it fails or is lost.
 * `read` gets a signal (aborted once the board stops waiting for it) and says whether it read
 * (false for an error). One read at a time (D-159): one that fails or throws is made again at once;
 * one still out after `deadlineMs`, which the database has ended by then, is aborted and made again.
 * A slow read is never given up while the database may still answer it. At most `tries` reads;
 * after the last fails or is lost it resolves false. Before WP-70 a failed read was dropped and a
 * hung one blocked every later read; WP-70's second and third reads beside a slow one (from 4 s)
 * tripled a board's load on a database that was already slow (WP-124's measurements).
 */
export function readSoon(
  read: (signal: AbortSignal) => Promise<boolean>,
  { deadlineMs = READ_DEADLINE_MS, tries = READ_TRIES } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    let made = 0;
    const next = () => {
      if (made >= tries) return resolve(false);
      made += 1;
      const r = new AbortController();
      let over = false;
      const settle = (ok: boolean) => {
        if (over) return;
        over = true;
        clearTimeout(lost);
        if (ok) return resolve(true);
        r.abort();
        next();
      };
      // Still out at the deadline: lost (the database has ended it), so the next is made.
      const lost = setTimeout(() => settle(false), deadlineMs);
      void read(r.signal)
        .catch(() => false)
        .then(settle);
    };
    next();
  });
}

/** Milliseconds until the next minute starts, so a clock ticks on the minute. */
export function untilNextMinute(now: Date): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}

import type { OccurrenceStatus } from '@familywise/rules-engine';

/**
 * [CHR-04][DEV-06][NFR-01] The board's outbox (01 §7): check-offs and undos wait here until
 * POST /api/completions answers them. Each event keeps the id it was made with, so sending it again
 * (a retry after a dropped connection, or after the board reloads) records nothing new (WP-10). With
 * a store (IndexedDB on the board, WP-13) it survives a reload or a long outage: what was waiting is
 * sent first, oldest first, when the board starts again. While the browser says it is offline nothing
 * is sent: events wait, and go when it says it is back (D-64).
 */
export interface CompletionEvent {
  id: string;
  occurrence_id: string;
  event_type: 'complete' | 'undo';
  /** When it happened on the board (ISO); the database clamps it to when it arrived. */
  occurred_at: string;
  done_by?: string[];
}

export interface Answer {
  id: string;
  result: 'recorded' | 'duplicate' | 'gone' | 'refused' | 'invalid';
  reason: string | null;
  /** The occurrence as the board may now see it. */
  occurrence: {
    id: string;
    status: OccurrenceStatus;
    done_by: string[];
    rewarded: string[];
    status_changed_at: string | null;
  } | null;
}

/** Sends a batch and returns each event's answer; throws when it could not be sent (retry later). */
export type Post = (events: CompletionEvent[]) => Promise<Answer[]>;

/** Where unanswered events wait between page loads. */
export interface OutboxStore {
  /** The events not yet answered, oldest first. */
  load(): Promise<CompletionEvent[]>;
  add(event: CompletionEvent): Promise<void>;
  remove(ids: string[]): Promise<void>;
}

/** Waits between retries: quick at first, then every 30 seconds. */
export const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export interface Outbox {
  send(event: CompletionEvent): void;
  /** Events not yet answered. */
  pending(): number;
  /** A send failed and a retry waits: the board is offline, or the server is not answering. */
  waiting(): boolean;
  /** Sends what waits now, without waiting for the retry (the network is back). */
  retry(): void;
  stop(): void;
}

export interface OutboxOptions {
  store?: OutboxStore;
  /** Called whenever pending() or waiting() may have changed. */
  onChange?: () => void;
  timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;
  /**
   * Whether the browser says it is online (`navigator.onLine` on the board). While it says not,
   * nothing is sent and a retry waits, so the board shows it is waiting; the board calls retry()
   * when the browser says it is back. A browser that says online while the network is down is
   * covered by the retries as before.
   */
  isOnline?: () => boolean;
}

export function createOutbox(
  post: Post,
  onAnswer: (answer: Answer, event: CompletionEvent | undefined) => void,
  { store, onChange, timers = globalThis, isOnline = () => true }: OutboxOptions = {},
): Outbox {
  const queue: CompletionEvent[] = [];
  let sending = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let loaded = !store;
  // Store writes run one after another, so an answer's removal never lands before its event's add.
  let writes: Promise<void> = Promise.resolve();
  const write = (op: (s: OutboxStore) => Promise<void>) => {
    if (store) writes = writes.then(() => op(store)).catch(() => undefined);
  };
  const changed = () => onChange?.();

  function later() {
    failures += 1;
    timer ??= timers.setTimeout(
      () => {
        timer = null;
        void flush();
      },
      RETRY_MS[Math.min(failures, RETRY_MS.length) - 1],
    );
  }

  async function flush() {
    if (sending || stopped || !loaded || queue.length === 0) return;
    // [NFR-01] Offline, by the browser's own word: hold everything, and look again at the next retry.
    if (!isOnline()) {
      later();
      changed();
      return;
    }
    sending = true;
    const batch = queue.slice(0, 100);
    try {
      const answers = await post(batch);
      failures = 0;
      for (const event of batch) queue.splice(queue.indexOf(event), 1);
      write((s) => s.remove(batch.map((e) => e.id)));
      for (const answer of answers) {
        onAnswer(
          answer,
          batch.find((e) => e.id === answer.id),
        );
      }
    } catch {
      later();
    } finally {
      sending = false;
      changed();
    }
    // Anything queued while this batch was out goes next (unless a retry is waiting).
    if (failures === 0 && timer === null) void flush();
  }

  // What waited from before goes first, ahead of anything sent while it was being read.
  if (store) {
    void store
      .load()
      .catch(() => [] as CompletionEvent[])
      .then((saved) => {
        const fresh = saved.filter((e) => !queue.some((q) => q.id === e.id));
        queue.unshift(...fresh);
        loaded = true;
        changed();
        void flush();
      });
  }

  return {
    send(event) {
      if (stopped) return;
      queue.push(event);
      write((s) => s.add(event));
      changed();
      // A send while a retry waits goes with the retry, so events stay in order.
      if (timer === null) void flush();
    },
    pending: () => queue.length,
    waiting: () => timer !== null,
    retry() {
      if (timer === null) return;
      timers.clearTimeout(timer);
      timer = null;
      void flush();
    },
    stop() {
      stopped = true;
      if (timer !== null) timers.clearTimeout(timer);
    },
  };
}

/** Keeps events in memory only (the UI suite's board, and tests). */
export function memoryStore(saved: CompletionEvent[] = []): OutboxStore & {
  events: CompletionEvent[];
} {
  const events = [...saved];
  return {
    events,
    load: async () => [...events],
    add: async (e) => {
      if (!events.some((x) => x.id === e.id)) events.push(e);
    },
    remove: async (ids) => {
      for (const id of ids) {
        const at = events.findIndex((e) => e.id === id);
        if (at >= 0) events.splice(at, 1);
      }
    },
  };
}

/**
 * The board's sender: POST /api/completions with its own session (cookies). Not signed in (401) is
 * retried like a dropped connection: the board itself notices a lost or disconnected session and
 * goes back to /board, and its events wait here until it is signed in again.
 */
export const postCompletions: Post = async (events) => {
  const res = await fetch('/api/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  // Refused as a whole (not this board's shape): sending it again cannot help, so each event is
  // answered as invalid and the board puts the tiles back. A server or network fault is retried.
  if (res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status)) {
    return events.map((e) => ({
      id: e.id,
      result: 'invalid',
      reason: 'bad_request',
      occurrence: null,
    }));
  }
  if (!res.ok) throw new Error(`completions: ${res.status}`);
  return ((await res.json()) as { results: Answer[] }).results;
};

import type { OccurrenceStatus } from '@familywise/rules-engine';

/**
 * [CHR-04][NFR-01] The board's outbox (01 §7, WP-11): check-offs and undos wait here until
 * POST /api/completions answers them. Each event keeps the id it was made with, so sending it again
 * (a retry after a dropped connection) records nothing new (WP-10). It lives in memory for now;
 * WP-13 keeps it in IndexedDB so it survives a reload or a long outage.
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

/** Waits between retries: quick at first, then every 30 seconds. */
export const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export interface Outbox {
  send(event: CompletionEvent): void;
  /** Events not yet answered. */
  pending(): number;
  stop(): void;
}

export function createOutbox(
  post: Post,
  onAnswer: (answer: Answer) => void,
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
): Outbox {
  const queue: CompletionEvent[] = [];
  let sending = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function flush() {
    if (sending || stopped || queue.length === 0) return;
    sending = true;
    const batch = queue.slice(0, 100);
    try {
      const answers = await post(batch);
      failures = 0;
      for (const event of batch) queue.splice(queue.indexOf(event), 1);
      for (const answer of answers) onAnswer(answer);
    } catch {
      failures += 1;
      timer ??= timers.setTimeout(
        () => {
          timer = null;
          void flush();
        },
        RETRY_MS[Math.min(failures, RETRY_MS.length) - 1],
      );
    } finally {
      sending = false;
    }
    // Anything queued while this batch was out goes next (unless a retry is waiting).
    if (failures === 0 && timer === null) void flush();
  }

  return {
    send(event) {
      if (stopped) return;
      queue.push(event);
      // A send while a retry waits goes with the retry, so events stay in order.
      if (timer === null) void flush();
    },
    pending: () => queue.length,
    stop() {
      stopped = true;
      if (timer !== null) timers.clearTimeout(timer);
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

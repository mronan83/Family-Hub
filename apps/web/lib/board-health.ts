import type { BoardSnapshot } from './snapshot';

/**
 * [DEV-08][US-206] Whether the board can be trusted right now, in the board's words (06 §2): it is
 * offline (its check-offs are saved, to send later), or what it shows is old (its last snapshot is
 * over five minutes old, or a job that keeps today's list up to date is behind).
 */

/** A snapshot older than this is stale (01 §7). While live, the board reads again sooner. */
export const STALE_AFTER_MS = 5 * 60_000;

/** The jobs that keep the board's list right: planning ahead, and closing past days. */
export const BOARD_JOBS = ['occurrence_gen', 'day_close'] as const;

/** A row of `public.job_health()`. */
export interface JobHealth {
  job_type: string;
  state: string;
}

/** A board job that is late or erroring. One that never ran (a new household) is not behind. */
export function jobsBehind(jobs: readonly JobHealth[]): boolean {
  return jobs.some(
    (j) =>
      (BOARD_JOBS as readonly string[]).includes(j.job_type) &&
      (j.state === 'stale' || j.state === 'failing'),
  );
}

export interface BoardHealth {
  /** "Offline: your check-offs are saved" (06 §2), or null. */
  offline: string | null;
  /** "Updated 12 minutes ago", or why the list may be out of date; null when it is fresh. */
  stale: string | null;
}

export function boardHealth({
  fetchedAt,
  now,
  offline,
  jobs,
}: {
  fetchedAt: string;
  now: Date;
  /** The browser has no network, or the outbox could not send. */
  offline: boolean;
  jobs: readonly JobHealth[];
}): BoardHealth {
  const age = now.getTime() - Date.parse(fetchedAt);
  return {
    offline: offline ? 'Offline: your check-offs are saved' : null,
    stale:
      age > STALE_AFTER_MS
        ? updatedAgo(age)
        : jobsBehind(jobs)
          ? 'Today’s list may be out of date'
          : null,
  };
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "Updated 12 minutes ago", "Updated 3 hours ago", "Updated 1 day ago". */
export function updatedAgo(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${plural(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${plural(hours, 'hour')} ago`;
  return `Updated ${plural(Math.floor(hours / 24), 'day')} ago`;
}

/**
 * [NFR-01] The snapshot to show when the board starts: the one the server drew, unless this board
 * saved a later one (it read on after the page was cached, or the page came from the cache offline).
 * A saved snapshot from another board, or in a shape this version doesn't read, is ignored.
 */
export function laterSnapshot(current: BoardSnapshot, saved: unknown): BoardSnapshot {
  if (
    typeof saved !== 'object' ||
    saved === null ||
    (saved as { v?: unknown }).v !== current.v ||
    (saved as BoardSnapshot).device?.id !== current.device.id ||
    typeof (saved as BoardSnapshot).fetchedAt !== 'string' ||
    !Array.isArray((saved as BoardSnapshot).members) ||
    !Array.isArray((saved as BoardSnapshot).occurrences)
  ) {
    return current;
  }
  const s = saved as BoardSnapshot;
  return Date.parse(s.fetchedAt) > Date.parse(current.fetchedAt) ? s : current;
}

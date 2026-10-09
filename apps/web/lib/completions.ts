import { z } from 'zod';

// Completion events (WP-10, 02 §4.1, D-20, D-46): what a board or an admin sends, and what comes back.
// The database decides everything that matters (who recorded it, the credit date, the flag, who is
// rewarded); this only checks the shape, so a malformed batch is refused before it reaches it.

export const EVENT_TYPES = [
  'complete',
  'undo',
  'approve',
  'reject',
  'admin_complete',
  'admin_uncomplete',
  'skip',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** At most this many events per request: an offline board replays its outbox in batches (DEV-06). */
export const MAX_BATCH = 100;

/** [CHR-04][NFR-06] One event: its id (made by the caller, the idempotency key) and when it happened. */
export const completionEventSchema = z
  .object({
    id: z.guid(),
    occurrence_id: z.guid(),
    event_type: z.enum(EVENT_TYPES),
    occurred_at: z.iso.datetime({ offset: true }),
    done_by: z.array(z.guid()).max(20).default([]),
    batch_id: z.guid().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type CompletionEvent = z.infer<typeof completionEventSchema>;

export const completionBatchSchema = z
  .object({ events: z.array(completionEventSchema).min(1).max(MAX_BATCH) })
  .strict();

/**
 * Each event's outcome: recorded; a duplicate of one already recorded (a replay, nothing new);
 * gone (a parent's edit removed its occurrence, D-45); refused (not this caller's to record, with
 * the reason, e.g. `undo_window_passed`); or invalid. `occurrence` is its state as the caller now
 * sees it, for the board to rebase its optimistic view on (null when it cannot see it).
 */
export type CompletionResult = {
  id: string;
  result: 'recorded' | 'duplicate' | 'gone' | 'refused' | 'invalid';
  reason: string | null;
  occurrence: {
    id: string;
    status: string;
    done_by: string[];
    rewarded: string[];
    status_changed_at: string | null;
  } | null;
};

/** The issues in a refused request body, as short `path: message` lines. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
}

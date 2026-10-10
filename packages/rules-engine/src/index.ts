// Pure reward logic shared by server and board (D-10). No I/O and no clock: "today" is an input.
// Contract: docs/02-data-model.md §5 (WP-15).
import type { OccurrenceStatus } from './types';

export type * from './types';
export { evaluateGoal } from './goal';
export { evaluateHistory } from './history';

/**
 * Stored on every derived row (reward_rule_progress, member_daily_summary, streak_segment). Bump it
 * when a rule's meaning changes, so the nightly job recomputes everything with the new rules.
 */
export const ENGINE_VERSION = 1;

export const OCCURRENCE_STATUSES: readonly OccurrenceStatus[] = [
  'scheduled',
  'completed',
  'pending_approval',
  'approved',
  'rejected',
  'skipped',
  'missed',
];

/** How an occurrence status counts toward progress, streaks and history (02 §4.2). */
export type StatusWeight = 'done' | 'neutral' | 'bad' | 'not_counted';

export function statusWeight(status: OccurrenceStatus): StatusWeight {
  switch (status) {
    case 'completed':
    case 'approved':
      return 'done';
    case 'skipped':
      return 'neutral';
    case 'missed':
      return 'bad';
    case 'scheduled':
    case 'pending_approval':
    case 'rejected':
      return 'not_counted';
  }
}

export function isDone(status: OccurrenceStatus): boolean {
  return statusWeight(status) === 'done';
}

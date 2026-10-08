// Pure reward logic shared by server and board (D-10). No I/O and no clock: "today" is an input.
// Contract: docs/02-data-model.md §5. evaluateGoal and evaluateHistory land in WP-15.

export type RuleType = 'COUNT' | 'STREAK' | 'DAILY_ALL_DONE' | 'POINTS';

export type OccurrenceStatus =
  'scheduled' | 'completed' | 'pending_approval' | 'approved' | 'rejected' | 'skipped' | 'missed';

export const OCCURRENCE_STATUSES: readonly OccurrenceStatus[] = [
  'scheduled',
  'completed',
  'pending_approval',
  'approved',
  'rejected',
  'skipped',
  'missed',
];

export interface RuleScope {
  all?: boolean;
  chore_ids?: string[];
  tags?: string[];
}

export interface StreakParams {
  /** Goal streaks only: misses forgiven per household week (default 1). */
  grace_per_week: number;
  qualify: { mode: 'all_scheduled' | 'min_count' | 'min_pct'; value?: number };
}

export interface Rule {
  id: string;
  type: RuleType;
  target: number;
  scope: RuleScope;
  params: Record<string, unknown>;
}

/** One row of chore_occurrence as the engine sees it. */
export interface OccurrenceFact {
  id: string;
  chore_id: string;
  member_id: string;
  tags: string[];
  due_date: string;
  status: OccurrenceStatus;
  points: number;
}

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

// The rules engine's inputs and outputs (02 §5). Field names follow the database rows they come
// from and go to (v_member_occurrence, reward_rule_progress, member_daily_summary, streak_segment).

export type RuleType = 'COUNT' | 'STREAK' | 'DAILY_ALL_DONE' | 'POINTS';

export type OccurrenceStatus =
  'scheduled' | 'completed' | 'pending_approval' | 'approved' | 'rejected' | 'skipped' | 'missed';

/** An occurrence's status for one member: `covered` when someone else did it (neutral, D-30). */
export type MemberStatus = OccurrenceStatus | 'covered';

/** What a rule measures (CHR-10): everything, or these items and items with these tags, by id. */
export interface RuleScope {
  all?: boolean;
  chore_ids?: string[];
  tag_ids?: string[];
}

/** When a day counts as good for a streak: every routine done (default), at least n, or at least n%. */
export interface Qualify {
  mode: 'all_scheduled' | 'min_count' | 'min_pct';
  value?: number;
}

/** A STREAK rule's `params`. */
export interface StreakParams {
  /** Bad days forgiven per household week (default 1). Goal streaks only; history has no grace. */
  grace_per_week: number;
  qualify: Qualify;
}

export interface Rule {
  id: string;
  type: RuleType;
  /** COUNT: items; POINTS: points; DAILY_ALL_DONE: days; STREAK: days in a row. */
  target: number;
  scope: RuleScope;
  params: Record<string, unknown>;
}

/** One occurrence for one member (a row of v_member_occurrence). */
export interface OccurrenceFact {
  id: string;
  chore_id: string;
  member_id: string;
  /** A chore is a routine (missed if not done on its day); a task is a to-do (never missed, D-31). */
  kind: 'chore' | 'task';
  tag_ids: string[];
  due_date: string;
  /** The day it counts for once done: a routine's due date, a task's day done. */
  credit_date: string | null;
  status: MemberStatus;
  /** True when this member is in `done_by`. */
  credited: boolean;
  /** The occurrence's points snapshot, so later edits to the item never change history. */
  points: number;
}

export type GoalStatus =
  'draft' | 'scheduled' | 'active' | 'achieved' | 'redeemed' | 'expired' | 'cancelled';

export interface GoalInput {
  goal: {
    id: string;
    /** Null for a family goal, which counts each done occurrence once whoever did it. */
    member_id: string | null;
    start_date: string;
    end_date: string | null;
    rule_logic: 'all' | 'any';
    status: GoalStatus;
  };
  rules: Rule[];
  occurrences: OccurrenceFact[];
  /** Today in the household (the engine never reads a clock). */
  asOf: string;
  /** The household's first day of the week: 0 Sunday … 6 Saturday. */
  weekStart: number;
}

/** One rule's progress (a reward_rule_progress row). */
export interface RuleProgress {
  rule_id: string;
  type: RuleType;
  /** Toward the target: items, points or days; for STREAK the current run until the target is reached. */
  current_value: number;
  target_value: number;
  /** 0 to 100. */
  pct: number;
  is_met: boolean;
  /** STREAK only. */
  current_streak: number | null;
  /** STREAK only. */
  best_streak: number | null;
  /** STREAK and DAILY_ALL_DONE: the last day that counted. */
  last_qualifying_date: string | null;
}

/** A change of goal status the evaluation calls for, in order; the caller records and acts on them. */
export interface GoalTransition {
  type: 'started' | 'achieved' | 'unachieved' | 'expired' | 'needs_review';
  from: GoalStatus;
  to: GoalStatus;
}

export interface GoalEvaluation {
  goal_id: string;
  /** 0 to 100: the mean of the rules' progress (`all`) or the best of them (`any`). */
  pct: number;
  is_achieved: boolean;
  rules: RuleProgress[];
  transitions: GoalTransition[];
}

export interface HistoryInput {
  memberId: string;
  occurrences: OccurrenceFact[];
  asOf: string;
}

/**
 * How a day went for a member, from their routines (02 §5): `good` and `bad` make runs, `neutral`
 * (nothing that counts) and `open` (today, or something still undecided) are passed over.
 */
export type DayClass = 'good' | 'bad' | 'neutral' | 'open';

/** One member's day (a member_daily_summary row). */
export interface DailySummary {
  date: string;
  /** Routines due that day. */
  scheduled: number;
  /** Routines and tasks done and credited to them, by the day they count for. */
  done: number;
  missed: number;
  skipped: number;
  /** Routines someone else did for them. */
  covered: number;
  points: number;
  dayClass: DayClass;
}

/** A run of good or bad days (a streak_segment row); `end` is null for the run still going. */
export interface StreakSegment {
  kind: 'good' | 'bad';
  start: string;
  end: string | null;
  length: number;
}

export interface HistoryEvaluation {
  days: DailySummary[];
  segments: StreakSegment[];
  current: { kind: 'good' | 'bad' | null; length: number };
  bestGood: number;
  worstBad: number;
}

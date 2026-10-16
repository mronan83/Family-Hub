// The rules engine's inputs and outputs (02 §5). Field names follow the database rows they come
// from and go to (v_member_occurrence, reward_rule_progress, member_daily_summary, streak_segment).

export type RuleType = 'COUNT' | 'STREAK' | 'DAILY_ALL_DONE' | 'POINTS' | 'DAYS_DUE';

/** [RWD-15] How a goal repeats: not at all, each household week, each calendar month, each school term. */
export type Repeat = 'none' | 'week' | 'month' | 'term';

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

/** [RWD-16] A DAYS_DUE rule's `params`: the days due in a period that may be missed (0 to 3). */
export interface DaysDueParams {
  misses_allowed: number;
}

/**
 * [RWD-17] When a check-off counts toward a rule (`params.on_time`): absent, any time that day;
 * 'due_time', by each chore's own due time (a chore without one counts any time); or a time of day,
 * 'HH:MM', on the household's clock. A tick after it still completes the chore; the rule doesn't
 * count it.
 */
export type OnTime = 'due_time' | `${number}:${number}`;

/**
 * [RWD-18] One step of a goal's (or period's) payout, highest first: the first is the goal's own
 * target and payout. On a goal with one "every day it's due" rule a step is days missed (`misses`, the
 * first 0); on a goal with one other rule, the number reached (`at`, the first the rule's target); on
 * a goal with two or more rules, the goal's weighted % (`at`, the first 100).
 */
export interface Step {
  misses?: number;
  at?: number;
  amount: number;
}

/** [RWD-18] Where a goal's (or period's) steps stand. */
export interface StepResult {
  /** The highest step reached (0 is the top), or null for none. */
  reached: number | null;
  /** The highest step still in reach (or reached), or null for none. */
  best: number | null;
  /** True when the step reached can no longer change but by a reversal: it is the one that pays. */
  final: boolean;
  /** The points the step reached pays, or null. */
  amount: number | null;
  /** The measure the steps read: days missed, the number reached, or the weighted %. */
  value: number;
}

export interface Rule {
  id: string;
  type: RuleType;
  /**
   * COUNT: items; POINTS: points; DAILY_ALL_DONE: days; STREAK: days in a row. DAYS_DUE: unused (its
   * target is each period's days due, less the misses allowed).
   */
  target: number;
  scope: RuleScope;
  params: Record<string, unknown>;
  /** [RWD-18] Its share of the goal's %, 1 to 100, on a goal with two or more rules and steps. */
  weight?: number | null;
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
  /** [RWD-17] The chore's due time, 'HH:MM', or null for none. */
  due_time?: string | null;
  /**
   * [RWD-17] When it was ticked, on the household's clock ('YYYY-MM-DDTHH:MM'): the check-off's own
   * time (kept by a board offline), not the approval's. Null when not ticked.
   */
  done_at?: string | null;
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
    /** [RWD-15] Absent or 'none': the goal doesn't repeat. */
    repeat?: Repeat;
    /** [RWD-18] What it pays at each step, highest first; absent or empty: no steps. */
    steps?: Step[];
  };
  rules: Rule[];
  /** [RWD-15] The school terms a term goal follows (the child's school year, or the family's). */
  terms?: { start_date: string; end_date: string }[];
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

/** [RWD-15] How a period of a repeating goal stands. */
export type PeriodOutcome = 'open' | 'won' | 'missed' | 'neutral';

/**
 * [RWD-16][RWD-17] A day of a week, for its mark: done, missed, missed by a tick after the rule's time
 * (`late`), still open (past, waiting), today, to come, or nothing due.
 */
export type DayMark = 'done' | 'missed' | 'late' | 'open' | 'today' | 'later' | 'none';

/** [RWD-15][RWD-16] One period of a repeating goal, from its first day due to today or its end. */
export interface PeriodResult {
  /** The period's days inside the goal's dates (a part first or last period is cut to them). */
  start: string;
  end: string;
  outcome: PeriodOutcome;
  /** The first day of the period after it, inside the goal's dates; null when none follows. */
  next_start: string | null;
  pct: number;
  rules: RuleProgress[];
  /** The first DAYS_DUE rule's days: due in the period, done, missed, and the misses allowed. */
  days_due: number | null;
  days_done: number | null;
  days_missed: number | null;
  misses_allowed: number | null;
  /** A week's days with a DAYS_DUE rule's mark each; null for months, terms and other rules. */
  days: { date: string; mark: DayMark }[] | null;
  /** [RWD-18] Where its steps stand; null for a goal without steps. */
  step: StepResult | null;
}

export interface GoalEvaluation {
  goal_id: string;
  /** 0 to 100: the mean of the rules' progress (`all`) or the best of them (`any`). */
  pct: number;
  is_achieved: boolean;
  rules: RuleProgress[];
  transitions: GoalTransition[];
  /**
   * [RWD-15] A repeating goal's periods, first to the one going now; empty for one that doesn't
   * repeat. Its `pct`, `rules` and `is_achieved` are then the period going now (or the last one).
   */
  periods: PeriodResult[];
  /** [RWD-18] A goal that doesn't repeat: where its steps stand; null without steps or when it repeats. */
  step: StepResult | null;
}

export interface HistoryInput {
  memberId: string;
  occurrences: OccurrenceFact[];
  /** Today: a day before it is settled, so a miss makes it bad; it and later days never are. */
  asOf: string;
  /** The last day to include (default `asOf`). Stored history stops at yesterday (D-55). */
  through?: string;
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

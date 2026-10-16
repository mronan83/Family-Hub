import {
  ENGINE_VERSION,
  evaluateGoal,
  type GoalEvaluation,
  type GoalInput,
  type GoalStatus,
  type OccurrenceFact,
  type Repeat,
  type Rule,
  type RuleType,
} from '@familywise/rules-engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import { monthDay, periodWord, spanWords } from './goal-periods';
import { goalSteps, type LowerStep, onTimeWords, stepKind, stepsPayWords } from './goal-steps';

/**
 * [RWD-04][RWD-06] Goals (WP-19, D-56). The database keeps each goal, its facts and its progress; the
 * rules engine works out the progress and the status changes it calls for, here, so the board, the
 * job and the admin app always read a goal the same way. Evaluating a goal is safe at any time and as
 * often as needed: the same facts give the same progress, and a status change is applied once (an
 * evaluation that read the goal before it changed is refused, and the goal is read again).
 */

export interface GoalRead {
  read_at: string;
  as_of: string;
  week_start: number;
  rules_version: number;
  /** [RWD-18] With its payout, whose steps the engine reads. */
  goal: GoalInput['goal'] & { payout?: GoalPayout };
  /** [RWD-15] The school terms a term goal follows. */
  terms?: GoalInput['terms'];
  rules: Rule[];
  facts: OccurrenceFact[];
  /** [RWD-20] The children an every-child goal is for. */
  members?: string[];
  /** [RWD-19] The periods of each goal its rules count. */
  sources?: GoalInput['sources'];
}

export interface GoalSave {
  saved: boolean;
  reason?: 'changed';
  status: GoalStatus;
  pct?: number;
  is_achieved?: boolean;
  transitions?: string[];
}

/** The engine's reading of one goal as goal_facts gave it. Pure. */
export function evaluateRead(read: GoalRead): GoalEvaluation {
  const { payout, ...goal } = read.goal;
  return evaluateGoal({
    goal: { ...goal, steps: goalSteps(payout, read.rules) },
    rules: read.rules,
    occurrences: read.facts,
    asOf: read.as_of,
    weekStart: read.week_start,
    terms: read.terms ?? [],
    members: read.members ?? [],
    sources: read.sources ?? {},
  });
}

/**
 * [RWD-04] Evaluates one goal and saves the result: reads its facts, runs the engine, stores the
 * progress and applies the status changes. If the goal changed between the read and the save, it
 * reads it once more. `db` is the job's (service role) or a parent's session; the database checks.
 */
export async function evaluateStoredGoal(db: SupabaseClient, goalId: string): Promise<GoalSave> {
  let last: GoalSave | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const read = await db.rpc('goal_facts', { p_goal: goalId });
    if (read.error) throw new Error(`read goal facts: ${read.error.message}`);
    const data = read.data as GoalRead;
    const evaluation = evaluateRead(data);
    const saved = await db.rpc('save_goal_evaluation', {
      p_goal: goalId,
      p_status: data.goal.status,
      p_rules_version: data.rules_version,
      p_evaluation: evaluation,
      p_engine_version: ENGINE_VERSION,
      p_read_at: data.read_at,
    });
    if (saved.error) throw new Error(`save goal evaluation: ${saved.error.message}`);
    last = saved.data as GoalSave;
    if (last.saved) return last;
  }
  return last!;
}

export interface GoalRunStats {
  goals: number;
  achieved: number;
  unachieved: number;
  started: number;
  expired: number;
  failed: number;
}

/**
 * [RWD-04][US-407] Evaluates every goal of a household that needs it (dirty, due to start or end,
 * computed by an older engine or rules, or not yet today). One goal's failure doesn't stop the others;
 * it is counted and reported, and the goal stays dirty for the next run.
 */
export async function evaluateHouseholdGoals(
  db: SupabaseClient,
  householdId: string,
  onError: (goalId: string, error: unknown) => void = () => {},
): Promise<GoalRunStats> {
  const { data, error } = await db.rpc('goals_to_evaluate', {
    p_household: householdId,
    p_engine_version: ENGINE_VERSION,
  });
  if (error) throw new Error(`list goals to evaluate: ${error.message}`);
  const stats: GoalRunStats = {
    goals: 0,
    achieved: 0,
    unachieved: 0,
    started: 0,
    expired: 0,
    failed: 0,
  };
  for (const goalId of (data ?? []) as string[]) {
    stats.goals += 1;
    try {
      const saved = await evaluateStoredGoal(db, goalId);
      for (const t of saved.transitions ?? []) {
        if (t === 'achieved') stats.achieved += 1;
        else if (t === 'unachieved') stats.unachieved += 1;
        else if (t === 'started') stats.started += 1;
        else if (t === 'expired') stats.expired += 1;
      }
    } catch (e) {
      stats.failed += 1;
      onError(goalId, e);
    }
  }
  return stats;
}

/**
 * [RWD-04] After check-offs are recorded: evaluates the goals of the households they touched, so a
 * goal's progress (and an achievement) follows a check-off within seconds instead of at the next
 * reconcile. Needs the service role (production only; previews rely on the Goals page and the job),
 * and never fails the caller: a goal that isn't evaluated stays dirty for the reconcile job.
 */
export async function evaluateAfterCompletions(
  db: SupabaseClient | null,
  occurrenceIds: string[],
  onError: (error: unknown) => void,
): Promise<void> {
  if (!db || occurrenceIds.length === 0) return;
  try {
    const { data, error } = await db
      .from('chore_occurrence')
      .select('household_id')
      .in('id', [...new Set(occurrenceIds)]);
    if (error) throw new Error(`find households: ${error.message}`);
    const households = [
      ...new Set((data as { household_id: string }[]).map((r) => r.household_id)),
    ];
    for (const h of households) await evaluateHouseholdGoals(db, h, (_g, e) => onError(e));
  } catch (e) {
    onError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// The parent's form
// ---------------------------------------------------------------------------------------------

export const RULE_TYPES: readonly RuleType[] = [
  'COUNT',
  'DAILY_ALL_DONE',
  'STREAK',
  'POINTS',
  'DAYS_DUE',
  'PERIODS_WON',
];

/** [RWD-15] How a goal may repeat, in the form's order. */
export const REPEATS: readonly Repeat[] = ['none', 'week', 'month', 'term'];

/** What each kind of rule counts, in the parent's words. */
export const RULE_WORDS: Record<RuleType, { label: string; unit: (n: number) => string }> = {
  COUNT: { label: 'Things done', unit: (n) => (n === 1 ? 'thing done' : 'things done') },
  DAILY_ALL_DONE: {
    label: 'Days with everything done',
    unit: (n) => (n === 1 ? 'day with everything done' : 'days with everything done'),
  },
  STREAK: {
    label: 'Good days in a row',
    unit: (n) => (n === 1 ? 'good day in a row' : 'good days in a row'),
  },
  POINTS: { label: 'Points earned', unit: (n) => (n === 1 ? 'point earned' : 'points earned') },
  DAYS_DUE: {
    label: 'Every day it’s due',
    unit: (n) => (n === 1 ? 'day it’s due' : 'days it’s due'),
  },
  // [RWD-19] The unit follows the goal it counts ("weeks", "months", "terms"): countedUnit().
  PERIODS_WON: {
    label: 'Weeks won of a repeating goal',
    unit: (n) => (n === 1 ? 'week won' : 'weeks won'),
  },
};

export type ScopeChoice = 'all' | 'tags' | 'items';

export interface RuleFormValue {
  type: RuleType;
  target: number;
  scope: { all: true } | { tag_ids?: string[]; chore_ids?: string[] };
  /**
   * [RWD-17] `on_time`: 'due_time' or 'HH:MM'; absent, any time that day. [RWD-19] `goal_id` and
   * `in_a_row`: the goal a PERIODS_WON rule counts, in a row or in total.
   */
  params: {
    grace_per_week?: number;
    misses_allowed?: number;
    on_time?: string;
    goal_id?: string;
    in_a_row?: boolean;
  };
  /** [RWD-18] Its share of the goal's % (1 to 100) on a goal with two or more rules paying in steps. */
  weight?: number | null;
}

/** [RWD-13][RWD-18] What reaching a goal pays, as save_goal() stores it; points may pay in steps. */
export type GoalPayout =
  | { type: 'custom' }
  | { type: 'points'; amount: number; steps?: LowerStep[] }
  | { type: 'catalog_item'; item_id: string };

export interface GoalFormValue {
  id: string;
  memberId: string | null;
  title: string;
  description: string | null;
  icon: string;
  startDate: string;
  endDate: string | null;
  logic: 'all' | 'any';
  /** [RWD-15] How it repeats; 'none' for a goal reached once. */
  repeat: Repeat;
  /**
   * [RWD-20] A family goal every child meets on their own; absent (a form loaded before it), the goal
   * keeps its own.
   */
  eachChild?: boolean;
  rules: RuleFormValue[];
  payout: GoalPayout;
}

export type ParsedGoal = { ok: true; value: GoalFormValue } | { ok: false; message: string };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (s: string) =>
  ISO_DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** The goal form's end date fields (D-115): this form has the check box, and the box itself. */
export const END_CHOICE_FIELD = 'endChoice';
/** [RWD-20] The goal form has the every-child box (sent whether it is ticked or not). */
export const EACH_CHILD_FIELD = 'eachChildField';
export const ENDS_ON_DATE_FIELD = 'endsOnDate';

/**
 * [RWD-14] The end date the goal form asks for, as typed ('' for none). With the check box (D-115),
 * an unticked box is no end date whatever date came with it; a ticked box with the date cleared is
 * no end date too. A form without the box (a page loaded before it, or a finished goal's fixed
 * dates) sends the date alone.
 */
export function readEndDate(form: FormData): string {
  if (form.has(END_CHOICE_FIELD) && !form.has(ENDS_ON_DATE_FIELD)) return '';
  return String(form.get('endDate') ?? '').trim();
}

/**
 * [RWD-01][RWD-02][RWD-03] The goal form, or a line saying what to fix. Rules arrive as rows named
 * `rule-<key>-<field>`, in the order `rule-keys` lists them: a type, a target, what counts (everything,
 * some tags, or some items) and, for a streak, how many missed days a week are forgiven.
 */
export function parseGoalForm(
  form: FormData,
  ctx: { icons: readonly string[]; memberIds: readonly string[] },
): ParsedGoal {
  const id = String(form.get('id') ?? '');
  if (!GUID.test(id)) return { ok: false, message: 'That goal isn’t there any more.' };
  const title = String(form.get('title') ?? '').trim();
  if (title.length < 1 || title.length > 80) {
    return { ok: false, message: 'Give the goal a name, up to 80 characters.' };
  }
  const description = String(form.get('description') ?? '').trim();
  if (description.length > 300) {
    return { ok: false, message: 'Keep the description to 300 characters.' };
  }
  const who = String(form.get('member') ?? '');
  if (who !== 'family' && !ctx.memberIds.includes(who)) {
    return { ok: false, message: 'Choose who the goal is for.' };
  }
  const startDate = String(form.get('startDate') ?? '');
  if (!realDay(startDate)) return { ok: false, message: 'Choose the day it starts.' };
  const endRaw = readEndDate(form);
  if (endRaw && !realDay(endRaw)) return { ok: false, message: 'That end date isn’t a day.' };
  if (endRaw && endRaw < startDate) {
    return { ok: false, message: 'It can’t end before it starts.' };
  }
  const logic = form.get('logic') === 'any' ? 'any' : 'all';
  // [RWD-15] A form without the choice (a page loaded before it, a started goal's fixed repeat) sends
  // `repeat` as a hidden field, or nothing: a goal that doesn't repeat.
  const repeatRaw = String(form.get('repeat') ?? 'none') as Repeat;
  const repeat: Repeat = REPEATS.includes(repeatRaw) ? repeatRaw : 'none';
  const icon = String(form.get('icon') ?? 'trophy');

  const keys = String(form.get('rule-keys') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => /^[a-z0-9]{1,12}$/.test(k));
  if (keys.length === 0) return { ok: false, message: 'Add at least one rule.' };
  if (keys.length > 5) return { ok: false, message: 'A goal has up to 5 rules.' };
  const rules: RuleFormValue[] = [];
  for (const [i, k] of keys.entries()) {
    const n = keys.length > 1 ? ` ${i + 1}` : '';
    const type = String(form.get(`rule-${k}-type`) ?? '') as RuleType;
    if (!RULE_TYPES.includes(type)) return { ok: false, message: `Choose what rule${n} counts.` };
    if (type === 'PERIODS_WON') {
      // [RWD-19] The repeating goal it counts, in total or in a row; it counts no items of its own.
      const source = String(form.get(`rule-${k}-source`) ?? '');
      if (!GUID.test(source)) {
        return { ok: false, message: `Rule${n}: choose the repeating goal it counts.` };
      }
      const target = Number(String(form.get(`rule-${k}-target`) ?? '').trim());
      if (!(Number.isInteger(target) && target >= 1 && target <= 100_000)) {
        return { ok: false, message: `Rule${n} needs a target from 1 to 100,000.` };
      }
      rules.push({
        type,
        target,
        scope: { all: true },
        params: { goal_id: source, in_a_row: form.get(`rule-${k}-row`) === 'row' },
      });
      continue;
    }
    if (type === 'DAYS_DUE' && repeat === 'none') {
      return {
        ok: false,
        message: `Rule${n}: every day it’s due is for a goal that repeats. Choose how it repeats, or another rule.`,
      };
    }
    // [RWD-16] Every day it's due has no target of its own: each period's days due decide it.
    const targetRaw = type === 'DAYS_DUE' ? '1' : String(form.get(`rule-${k}-target`) ?? '').trim();
    const target = /^\d+$/.test(targetRaw) ? Number(targetRaw) : NaN;
    if (!(target >= 1 && target <= 100_000)) {
      return { ok: false, message: `Rule${n} needs a target from 1 to 100,000.` };
    }
    const scopeChoice = String(form.get(`rule-${k}-scope`) ?? 'all') as ScopeChoice;
    let scope: RuleFormValue['scope'] = { all: true };
    if (scopeChoice === 'tags') {
      const tags = form
        .getAll(`rule-${k}-tag`)
        .map(String)
        .filter((t) => GUID.test(t));
      if (tags.length === 0) return { ok: false, message: `Choose a tag for rule${n}.` };
      scope = { tag_ids: [...new Set(tags)].sort() };
    } else if (scopeChoice === 'items') {
      const items = form
        .getAll(`rule-${k}-item`)
        .map(String)
        .filter((t) => GUID.test(t));
      if (items.length === 0) return { ok: false, message: `Choose an item for rule${n}.` };
      scope = { chore_ids: [...new Set(items)].sort() };
    }
    const params: RuleFormValue['params'] = {};
    // [RWD-17] When a tick counts: any time that day, by each chore's due time, or by a time.
    const on = String(form.get(`rule-${k}-ontime`) ?? 'any');
    if (on === 'due_time') params.on_time = 'due_time';
    else if (on === 'by') {
      const t = String(form.get(`rule-${k}-ontime-at`) ?? '').trim();
      if (!CLOCK.test(t)) return { ok: false, message: `Rule${n}: choose the time it counts by.` };
      params.on_time = t;
    }
    if (type === 'STREAK') {
      const grace = Number(form.get(`rule-${k}-grace`) ?? 1);
      params.grace_per_week = [0, 1, 2, 3].includes(grace) ? grace : 1;
    } else if (type === 'DAYS_DUE') {
      const misses = Number(form.get(`rule-${k}-misses`) ?? 0);
      params.misses_allowed = [0, 1, 2, 3].includes(misses) ? misses : 0;
    }
    const weightRaw = String(form.get(`rule-${k}-weight`) ?? '').trim();
    const weight = /^\d+$/.test(weightRaw) ? Number(weightRaw) : null;
    rules.push({ type, target, scope, params, ...(weight !== null ? { weight } : {}) });
  }
  // [RWD-13] What reaching it pays: the celebration only, points, or a reward from the shop.
  let payout: GoalPayout = { type: 'custom' };
  const pays = String(form.get('payout') ?? 'custom');
  if (pays === 'points') {
    const raw = String(form.get('payoutPoints') ?? '').trim();
    const amount = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!(amount >= 1 && amount <= 10_000)) {
      return { ok: false, message: 'Points paid: a whole number from 1 to 10,000.' };
    }
    payout = { type: 'points', amount };
    // [RWD-18] Pay in steps: up to 3 lower steps, each days missed (one "every day it's due" rule)
    // or where it's reached (a number, or the goal's % with two or more rules), and its points.
    if (form.get('payoutSteps') === 'on') {
      const steps = readSteps(form, rules, amount, endRaw || null, repeat);
      if (!steps.ok) return steps;
      payout = { type: 'points', amount, steps: steps.value };
      if (steps.weighted) {
        const total = rules.reduce((sum, r) => sum + (r.weight ?? 0), 0);
        if (rules.some((r) => !r.weight || r.weight < 1 || r.weight > 100) || total !== 100) {
          return {
            ok: false,
            message: `Give each rule a weight; together they make 100% (now ${total}%).`,
          };
        }
      }
      if (stepKind(rules) === 'misses') {
        rules[0]!.params.misses_allowed = steps.value.at(-1)!.misses!;
      }
    }
  } else if (pays === 'item') {
    if (who === 'family') {
      return {
        ok: false,
        message: 'A family goal pays points to each child, or just the celebration.',
      };
    }
    const item = String(form.get('payoutItem') ?? '');
    if (!GUID.test(item)) return { ok: false, message: 'Choose the reward from the shop.' };
    payout = { type: 'catalog_item', item_id: item };
  }
  // [RWD-20] Every child meets it: a family goal's option, without steps or a counted rule (D-126).
  const eachChild = form.has(EACH_CHILD_FIELD)
    ? who === 'family' && form.get('eachChild') === 'on'
    : undefined;
  if (eachChild && payout.type === 'points' && payout.steps?.length) {
    return { ok: false, message: 'Pay in steps isn’t offered when every child meets it.' };
  }
  if (eachChild && rules.some((r) => r.type === 'PERIODS_WON')) {
    return {
      ok: false,
      message: 'When every child meets it, the goal can’t count another goal’s weeks.',
    };
  }
  // [RWD-18] Weights are for a goal with two or more rules that pays in steps; it is reached at 100%.
  const weighted = payout.type === 'points' && !!payout.steps?.length && rules.length > 1;
  if (!weighted) for (const r of rules) delete r.weight;
  return {
    ok: true,
    value: {
      id,
      memberId: who === 'family' ? null : who,
      title,
      description: description || null,
      icon: ctx.icons.includes(icon) ? icon : 'trophy',
      startDate,
      endDate: endRaw || null,
      logic: weighted ? 'all' : logic,
      repeat,
      eachChild,
      rules,
      payout,
    },
  };
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The form's step fields, `step-<i>-at` (or `-misses`) and `step-<i>-amount`, for i 1 to 3. */
function readSteps(
  form: FormData,
  rules: RuleFormValue[],
  top: number,
  end: string | null,
  repeat: Repeat,
): { ok: true; value: LowerStep[]; weighted: boolean } | { ok: false; message: string } {
  const kind = stepKind(rules);
  if (repeat === 'none' && !end) {
    return {
      ok: false,
      message: 'A goal that pays in steps needs an end date: a lower step pays when it ends.',
    };
  }
  const out: LowerStep[] = [];
  let prevAmount = top;
  let prevAt = kind === 'misses' ? 0 : kind === 'weighted' ? 100 : (rules[0]?.target ?? 0);
  for (const i of [1, 2, 3]) {
    const atRaw = String(form.get(`step-${i}-at`) ?? '')
      .trim()
      .replace(/%$/, '');
    const amountRaw = String(form.get(`step-${i}-amount`) ?? '').trim();
    // A misses step left empty is none; a number step needs both.
    if (!amountRaw && (kind === 'misses' || !atRaw)) continue;
    const at = /^\d+$/.test(atRaw) ? Number(atRaw) : NaN;
    const amount = /^\d+$/.test(amountRaw) ? Number(amountRaw) : NaN;
    if (!(amount >= 1 && amount < prevAmount)) {
      return {
        ok: false,
        message: `Step ${i + 1} pays fewer points than the step above it, 1 or more.`,
      };
    }
    if (kind === 'misses') {
      if (!(at > prevAt && at <= 3)) {
        return {
          ok: false,
          message: `Step ${i + 1}: more days missed than the step above, up to 3.`,
        };
      }
      out.push({ misses: at, amount });
    } else {
      if (!(at >= 1 && at < prevAt)) {
        return {
          ok: false,
          message: `Step ${i + 1} is reached at less than the step above${kind === 'weighted' ? ' (under 100%)' : ''}.`,
        };
      }
      out.push({ at, amount });
    }
    prevAmount = amount;
    prevAt = at;
  }
  if (out.length === 0)
    return { ok: false, message: 'Add at least one lower step, or untick Pay in steps.' };
  return { ok: true, value: out, weighted: kind === 'weighted' };
}

/** What save_goal() takes. `imagePath` is sent only when the photo changes (null removes it). */
export function goalPayload(
  v: GoalFormValue,
  householdId: string,
  imagePath?: string | null,
): Record<string, unknown> {
  return {
    id: v.id,
    household_id: householdId,
    member_id: v.memberId,
    title: v.title,
    description: v.description,
    icon: v.icon,
    start_date: v.startDate,
    end_date: v.endDate,
    rule_logic: v.logic,
    repeat: v.repeat,
    ...(v.eachChild !== undefined ? { each_child: v.eachChild } : {}),
    rules: v.rules,
    payout: v.payout,
    ...(imagePath !== undefined ? { image_path: imagePath } : {}),
  };
}

/** A database refusal of a goal change in the parent's words. */
export function goalRefusal(error: { code?: string | null; hint?: string | null }): string {
  switch (error.hint) {
    case 'not_earning':
      return 'Goals are for someone who earns rewards, or the whole family.';
    case 'goal_started':
      return 'This goal has started, so who it’s for and its start date stay as they are.';
    case 'goal_closed':
      return 'This goal has finished, so its rules and dates stay as they are.';
    case 'goal_achieved':
      return 'This goal has been reached, so its rules and dates stay as they are.';
    case 'repeat_fixed':
      return 'This goal has started, so how it repeats stays as it is.';
    case 'repeat':
      return 'Choose how it repeats: each week, month or school term, or not at all.';
    case 'rule_source':
      return 'A goal counts the weeks of a repeating goal for the same person (or the family’s), and not one that counts weeks itself. A goal another goal counts keeps repeating.';
    case 'each_child_family':
      return 'Every child meets it is for a family goal.';
    case 'each_child_steps':
      return 'Pay in steps isn’t offered when every child meets it.';
    case 'each_child_counted':
      return 'When every child meets it, the goal can’t count another goal’s weeks.';
    case 'each_child_fixed':
      return 'This goal has started, so every child meets it stays as it is.';
    case 'rule_repeat':
      return 'Every day it’s due is for a goal that repeats. Choose how it repeats, or another rule.';
    case 'rule_misses':
      return 'Misses allowed: 0 to 3.';
    case 'rule_on_time':
      return 'A rule counts by each chore’s due time, or by a time of day.';
    case 'rule_weight':
      return 'A rule’s weight is a whole number from 1 to 100.';
    case 'rule_weights':
      return 'Give each rule a weight; together they make 100%.';
    case 'payout_steps':
      return 'Each step pays fewer points than the one above it, and is reached with less.';
    case 'payout_steps_points':
      return 'Steps pay points.';
    case 'steps_end_date':
      return 'A goal that pays in steps needs an end date: a lower step pays when it ends.';
    case 'not_repeating':
      return 'Only a goal that repeats stops after this period.';
    case 'not_started':
      return 'Only a goal that is going stops after this period. Cancel it instead.';
    case 'end_in_past':
      return 'A goal that has started ends today or later.';
    case 'end_before_start':
      return 'It can’t end before it starts.';
    case 'rule_scope':
      return 'A rule counts a tag or item this family doesn’t have. Choose again.';
    case 'rules_count':
      return 'A goal has 1 to 5 rules.';
    case 'payout_points':
      return 'Points paid: a whole number from 1 to 10,000.';
    case 'payout_item':
      return 'That reward isn’t in the shop any more. Choose another.';
    case 'payout_family_item':
      return 'A family goal pays points to each child, or just the celebration.';
    case 'not_achieved':
      return 'Only an achieved goal can be marked redeemed.';
    case 'goal_redeemed':
      return 'A redeemed goal stays redeemed.';
    case 'not_allowed':
      return 'Only a parent of this family can do that.';
    default:
      return error.code === '23514'
        ? 'Something in the form isn’t right. Check the name and description.'
        : 'That didn’t save. Try again in a moment.';
  }
}

// ---------------------------------------------------------------------------------------------
// Words for the Goals page
// ---------------------------------------------------------------------------------------------

/** "20 things done, tagged Morning or Kitchen" · "5 good days in a row (1 miss a week forgiven)". */
export function describeRule(
  r: { type: RuleType; target: number; scope: RuleFormValue['scope']; params: Rule['params'] },
  names: {
    tags: Map<string, string>;
    items: Map<string, string>;
    /** [RWD-19] The goals a rule may count, by id. */
    goals?: Map<string, { title: string; repeat: Repeat }>;
  },
): string {
  if (r.type === 'PERIODS_WON') {
    // [RWD-19] "3 weeks won in a row, of Homework home every school day".
    const p = r.params as { goal_id?: string; in_a_row?: boolean };
    const source = p.goal_id ? names.goals?.get(p.goal_id) : undefined;
    const unit = countedUnit(source?.repeat, r.target);
    return `${r.target.toLocaleString('en-US')} ${unit} won${p.in_a_row ? ' in a row' : ''}, of ${
      source?.title ?? 'a removed goal'
    }`;
  }
  const head =
    r.type === 'DAYS_DUE'
      ? RULE_WORDS.DAYS_DUE.label
      : `${r.target.toLocaleString('en-US')} ${RULE_WORDS[r.type].unit(r.target)}`;
  const parts: string[] = [];
  if (!('all' in r.scope)) {
    const tags = (r.scope.tag_ids ?? []).map((t) => names.tags.get(t) ?? 'a removed tag');
    const items = (r.scope.chore_ids ?? []).map((t) => names.items.get(t) ?? 'a removed item');
    if (tags.length) parts.push(`tagged ${orList(tags)}`);
    if (items.length) parts.push(`from ${orList(items)}`);
  }
  let text = parts.length ? `${head}, ${parts.join(' or ')}` : head;
  if (r.type === 'STREAK') {
    const grace = Number((r.params as { grace_per_week?: number }).grace_per_week ?? 1);
    text +=
      grace === 0
        ? ' (no misses forgiven)'
        : ` (${grace} miss${grace > 1 ? 'es' : ''} a week forgiven)`;
  }
  if (r.type === 'DAYS_DUE') {
    const misses = Number((r.params as { misses_allowed?: number }).misses_allowed ?? 0);
    text +=
      misses === 0 ? ' (no misses allowed)' : ` (${misses} miss${misses > 1 ? 'es' : ''} allowed)`;
  }
  // [RWD-17] "…, by 6:00 pm".
  const by = onTimeWords((r.params as { on_time?: string }).on_time);
  if (by) text += `, ${by}`;
  return text;
}

/** [RWD-19] "week" or "weeks" (or months, terms) for the goal a rule counts. */
export function countedUnit(repeat: Repeat | undefined, n: number): string {
  return periodWord(repeat && repeat !== 'none' ? repeat : 'week', n);
}

function orList(words: string[]): string {
  if (words.length <= 2) return words.join(' or ');
  return `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
}

/** A streak's run now and its best, which the meter (the best run toward the target) doesn't say. */
export function streakLine(p: { current: number; best: number; met: boolean }): string {
  if (p.met) return p.current > 0 ? `Reached. ${p.current} in a row now.` : 'Reached.';
  return p.current === p.best
    ? `${p.current} in a row now`
    : `${p.current} in a row now, best ${p.best}`;
}

export const STATUS_WORDS: Record<GoalStatus, string> = {
  draft: 'Draft',
  scheduled: 'Starts later',
  active: 'Going',
  achieved: 'Achieved',
  redeemed: 'Redeemed',
  expired: 'Ended',
  cancelled: 'Cancelled',
};

/** Goals still in play come first on the page; the rest are history. */
export const OPEN_STATUSES: readonly GoalStatus[] = ['achieved', 'active', 'scheduled', 'draft'];

/** 2 → "2nd", 3 → "3rd", 11 → "11th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** A goal event in the parent's words. */
export function eventWords(e: { type: string; payload: Record<string, unknown> }): string {
  const n = typeof e.payload.n === 'number' ? e.payload.n : null;
  const points = typeof e.payload.points === 'number' ? e.payload.points : 0;
  // [RWD-15] A repeating goal's events name their period: "Oct 5 to 11 won: paid 10 points".
  const start = typeof e.payload.period_start === 'string' ? e.payload.period_start : null;
  const end = typeof e.payload.period_end === 'string' ? e.payload.period_end : null;
  if (start && end) {
    const span = spanWords({ start, end, outcome: 'won' });
    const paid = e.payload.paid as
      { type?: string; amount?: number; children?: number } | undefined;
    switch (e.type) {
      case 'achieved':
        if (paid?.type === 'points' && paid.amount) {
          const each = (paid.children ?? 1) > 1 ? ' each' : '';
          return `${span} won: paid ${pointsWord(paid.amount)}${each}`;
        }
        if (paid?.type === 'catalog_item')
          return `${span} won: its reward from the shop is approved`;
        return `${span} won`;
      case 'unachieved':
        return `${span} no longer won: a check-off it needed was undone`;
      case 'payout_reversed': {
        const parts: string[] = [];
        if (points > 0) parts.push(`${pointsWord(points)} taken back`);
        if (e.payload.item === 'called_off') parts.push('its reward from the shop called off');
        return `${span}: ${parts.join(', ') || 'payout undone'}`;
      }
    }
  }
  // [RWD-20] A parent's fix changed who had something due in a won week: each child's pay followed.
  if (e.type === 'payees_changed') {
    const head = start && end ? spanWords({ start, end, outcome: 'won' }) : 'Who it pays';
    const moved =
      points > 0
        ? `${pointsWord(points)} more paid`
        : points < 0
          ? `${pointsWord(-points)} taken back`
          : 'nothing moved';
    return `${head}: who had something due changed, ${moved}`;
  }
  // [RWD-18] A parent's fix moved a reached goal or won period to another step.
  if (e.type === 'step_changed') {
    const amount = typeof e.payload.amount === 'number' ? e.payload.amount : 0;
    const head = start && end ? spanWords({ start, end, outcome: 'won' }) : 'Its step';
    const moved =
      points > 0
        ? `${pointsWord(points)} more paid`
        : points < 0
          ? `${pointsWord(-points)} taken back`
          : 'nothing moved';
    return `${head} now pays ${pointsWord(amount)}: ${moved}`;
  }
  switch (e.type) {
    case 'stopped':
      return typeof e.payload.end_date === 'string'
        ? `Set to stop after ${monthDay(e.payload.end_date)}`
        : 'Set to stop';
    case 'created':
      return 'Set up';
    case 'edited':
      return e.payload.payout ? 'What it pays changed' : 'Name or picture changed';
    case 'activated':
      return 'Started';
    case 'rules_changed':
      return 'Rules or dates changed';
    case 'recomputed':
      return `Progress worked out again: ${e.payload.from_pct}% to ${e.payload.to_pct}%`;
    case 'achieved': {
      const head = n && n > 1 ? `Achieved again (${ordinal(n)} time)` : 'Achieved';
      const paid = e.payload.paid as
        { type?: string; amount?: number; children?: number } | undefined;
      if (paid?.type === 'points' && paid.amount) {
        const each = (paid.children ?? 1) > 1 ? ' each' : '';
        return `${head}: paid ${pointsWord(paid.amount)}${each}`;
      }
      if (paid?.type === 'catalog_item') return `${head}: its reward from the shop is approved`;
      return head;
    }
    case 'unachieved':
      return 'Back to going: a check-off it needed was undone';
    case 'payout_reversed': {
      const parts: string[] = [];
      if (points > 0) parts.push(`${pointsWord(points)} taken back`);
      if (e.payload.item === 'called_off') parts.push('its reward from the shop called off');
      return parts.length ? `Payout undone: ${parts.join(', ')}` : 'Payout undone';
    }
    case 'payout_restored':
      return `Met again: ${pointsWord(points)} put back`;
    case 'needs_review':
      return e.payload.why === 'reward_given'
        ? 'Needs a look: a check-off it needed was undone after its reward was given'
        : 'Needs a look: a check-off it needed was undone after it was redeemed';
    case 'redeemed':
      return 'Redeemed';
    case 'expired':
      return 'Ended before it was reached';
    case 'cancelled':
      return 'Cancelled';
    default:
      return e.type;
  }
}

function pointsWord(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'point' : 'points'}`;
}

/**
 * [RWD-13] What a goal pays, in the parent's words: "10 points", "10 points each" (a family goal),
 * "Ice cream from the shop", or null for the celebration only. `item` names the shop's reward.
 */
export function payoutWords(
  payout: GoalPayout,
  family: boolean,
  item: (id: string) => string | undefined,
): string | null {
  if (payout.type === 'points' && payout.steps?.length) {
    return stepsPayWords(
      [{ amount: payout.amount }, ...payout.steps.map((x) => ({ amount: x.amount }))],
      family,
    );
  }
  if (payout.type === 'points') return `${pointsWord(payout.amount)}${family ? ' each' : ''}`;
  if (payout.type === 'catalog_item') return `${item(payout.item_id) ?? 'a reward'} from the shop`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// [RWD-10][US-406] The preview of a change, before it is saved
// ---------------------------------------------------------------------------------------------

/** What goal_preview_facts gives: the facts an evaluation would read for the form's dates and person. */
export interface PreviewRead {
  as_of: string;
  week_start: number;
  /** [RWD-15] The terms a term goal follows. */
  terms?: GoalInput['terms'];
  status: GoalStatus;
  saved: boolean;
  facts: OccurrenceFact[];
  /** [RWD-20] The children who earn rewards. */
  members?: string[];
  /** [RWD-19] The periods of each goal the form's rules count. */
  sources?: GoalInput['sources'];
}

export interface PreviewSide {
  pct: number;
  achieved: boolean;
  rules: { value: number; target: number; pct: number; met: boolean }[];
}

export interface GoalPreviewResult {
  /** The goal as saved, worked out now; null for a goal not yet set. */
  before: PreviewSide | null;
  after: PreviewSide;
  /** [RWD-15] A repeating goal's period going now, as the form would have it; null otherwise. */
  period: GoalEvaluation['periods'][number] | null;
  /** The status changes saving would make: started, achieved, unachieved, expired. */
  transitions: string[];
}

const side = (e: GoalEvaluation): PreviewSide => ({
  pct: e.pct,
  achieved: e.is_achieved,
  rules: e.rules.map((r) => ({
    value: r.current_value,
    target: r.target_value,
    pct: r.pct,
    met: r.is_met,
  })),
});

/**
 * [RWD-10] Old and new progress from every check-off, and what saving would change. Pure: the form's
 * goal is run through the engine on `read` (its facts as goal_preview_facts gives them), the saved
 * goal on `stored` (goal_facts, null for a new goal).
 */
export function previewGoal(
  v: GoalFormValue,
  read: PreviewRead,
  stored: GoalRead | null,
): GoalPreviewResult {
  const after = evaluateGoal({
    goal: {
      id: v.id,
      member_id: v.memberId,
      start_date: v.startDate,
      end_date: v.endDate,
      rule_logic: v.logic,
      status: read.status,
      repeat: v.repeat,
      steps: goalSteps(v.payout, v.rules),
      each_child: v.eachChild ?? false,
    },
    rules: v.rules.map((r, i) => ({ id: `rule-${i + 1}`, ...r })) as Rule[],
    occurrences: read.facts,
    asOf: read.as_of,
    weekStart: read.week_start,
    terms: read.terms ?? [],
    members: read.members ?? [],
    sources: read.sources ?? {},
  });
  return {
    before: stored ? side(evaluateRead(stored)) : null,
    after: side(after),
    period:
      after.periods.find((p) => p.start <= read.as_of && read.as_of <= p.end) ??
      after.periods.at(-1) ??
      null,
    transitions: after.transitions.map((t) => t.type),
  };
}

/**
 * [RWD-10][RWD-13] What saving would do, in one line: reach it (and pay), take it back (and what it
 * paid), end it, or leave it reached or going with its progress before and after. `pays` is what the
 * form says it pays; `paid` what the goal paid when it was last reached.
 */
export function previewOutcome(
  p: GoalPreviewResult,
  words: { saved: boolean; pays: string | null; paid: string | null; paidItem: boolean },
): string {
  const t = p.transitions;
  const now = p.before ? `${Math.round(p.before.pct)}%` : null;
  const then = `${Math.round(p.after.pct)}%`;
  if (t.includes('achieved')) {
    const verb = words.saved ? 'Saving reaches it now' : 'Setting it reaches it at once';
    return words.pays ? `${verb}, and it pays ${words.pays}.` : `${verb}.`;
  }
  if (t.includes('unachieved')) {
    const back = !words.paid
      ? ''
      : words.paidItem
        ? `, and ${words.paid} is called off (if it was already given, the goal is flagged for a look)`
        : `, and what it paid (${words.paid}) is taken back`;
    return `Saving takes it back to going: ${then} there${back}.`;
  }
  if (t.includes('expired')) return `Saving ends it: its end date has passed at ${then}.`;
  if (p.after.achieved) return 'It stays reached; nothing is paid again.';
  if (!now) return `It starts ${then} of the way there, from what’s already done.`;
  return now === then
    ? `Its progress stays at ${then}.`
    : `Its progress goes from ${now} to ${then}.`;
}

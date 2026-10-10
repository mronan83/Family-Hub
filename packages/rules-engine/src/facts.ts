import type { DayClass, OccurrenceFact, Qualify, RuleScope } from './types';

/** What a fact means for its member: done (and credited to them), or why not. */
export type FactState = 'done' | 'pending' | 'open' | 'missed' | 'skipped' | 'covered';

/**
 * [CHR-07][D-30][D-32] Done only when completed or approved and credited to this member; done or
 * waiting by someone else is covered (neutral, like skipped). Scheduled and rejected are still open.
 */
export function factState(f: Pick<OccurrenceFact, 'status' | 'credited'>): FactState {
  switch (f.status) {
    case 'completed':
    case 'approved':
      return f.credited ? 'done' : 'covered';
    case 'pending_approval':
      return f.credited ? 'pending' : 'covered';
    case 'scheduled':
    case 'rejected':
      return 'open';
    case 'missed':
      return 'missed';
    case 'skipped':
      return 'skipped';
    case 'covered':
      return 'covered';
  }
}

/** The day a done fact counts for: its credit date, else its due date. */
export const creditDate = (f: OccurrenceFact): string => f.credit_date ?? f.due_date;

/** [CHR-10][RWD-02] In scope: everything, or one of these items, or carrying one of these tags (by id). */
export function inScope(f: OccurrenceFact, scope: RuleScope): boolean {
  if (scope.all) return true;
  return (
    (scope.chore_ids?.includes(f.chore_id) ?? false) ||
    (scope.tag_ids?.some((t) => f.tag_ids.includes(t)) ?? false)
  );
}

/** What the rules count: a member's own fact, or for a family goal one occurrence however shared. */
export interface Unit {
  fact: OccurrenceFact;
  state: FactState;
}

const byId = (a: Unit, b: Unit) => (a.fact.id < b.fact.id ? -1 : a.fact.id > b.fact.id ? 1 : 0);

/** One member's facts, in a fixed order so the input's order never matters. */
export function memberUnits(facts: OccurrenceFact[], memberId: string): Unit[] {
  return facts
    .filter((f) => f.member_id === memberId)
    .map((fact) => ({ fact, state: factState(fact) }))
    .sort(byId);
}

/**
 * An occurrence has one status, which each member sees as is, or as covered when someone else did
 * it. So the family's view is whoever did it, else anyone's but a covered one.
 */
const rank = (f: OccurrenceFact) => (f.credited ? 0 : f.status === 'covered' ? 2 : 1);

/** [D-30] A family goal's facts, one per occurrence, as whoever did it saw it. */
export function familyUnits(facts: OccurrenceFact[]): Unit[] {
  const best = new Map<string, OccurrenceFact>();
  for (const fact of facts) {
    const had = best.get(fact.id);
    if (
      !had ||
      rank(fact) < rank(had) ||
      (rank(fact) === rank(had) && fact.member_id < had.member_id)
    ) {
      best.set(fact.id, fact);
    }
  }
  return [...best.values()].map((fact) => ({ fact, state: factState(fact) })).sort(byId);
}

/** A day's routines by state. */
export interface DayTally {
  done: number;
  pending: number;
  open: number;
  missed: number;
  skipped: number;
  covered: number;
}

const emptyTally = (): DayTally => ({
  done: 0,
  pending: 0,
  open: 0,
  missed: 0,
  skipped: 0,
  covered: 0,
});

/** [D-31] Routines only, by due date: tasks never make a day good or bad. */
export function tallyRoutines(units: Unit[]): Map<string, DayTally> {
  const days = new Map<string, DayTally>();
  for (const u of units) {
    if (u.fact.kind !== 'chore') continue;
    let t = days.get(u.fact.due_date);
    if (!t) days.set(u.fact.due_date, (t = emptyTally()));
    t[u.state] += 1;
  }
  return days;
}

/** Done enough of the routines that count (`counted` excludes skipped and covered). */
export function qualifies(done: number, counted: number, q: Qualify): boolean {
  switch (q.mode) {
    case 'all_scheduled':
      return done >= counted;
    case 'min_count':
      // A day with fewer routines than the count qualifies when all of them are done.
      return done >= Math.min(q.value ?? counted, counted);
    case 'min_pct':
      return done * 100 >= (q.value ?? 100) * counted;
  }
}

/**
 * [RWD-05][RWD-11][D-51] A day's class (02 §5):
 * - neutral: no routine that counts (none, or all skipped or covered);
 * - good: enough done, today included the moment it qualifies;
 * - open: today, or a day with something still to do or waiting for a parent; never bad;
 * - bad: a past day settled without enough done (so something was missed).
 */
export function classifyDay(date: string, t: DayTally, asOf: string, q: Qualify): DayClass {
  const counted = t.done + t.pending + t.open + t.missed;
  if (counted === 0) return 'neutral';
  if (qualifies(t.done, counted, q)) return 'good';
  if (date >= asOf || t.pending + t.open > 0) return 'open';
  return 'bad';
}

export const ALL_DONE: Qualify = { mode: 'all_scheduled' };

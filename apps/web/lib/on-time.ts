import {
  inScope,
  type GoalEvaluation,
  type OccurrenceFact,
  type OccurrenceStatus,
  type PeriodResult,
  type Repeat,
  type RuleScope,
} from '@familywise/rules-engine';
import { localInstant, minutesOf } from './board-sleep';
import { clock } from './chores';
import { monthDay, periodWord, shortDay } from './goal-periods';

// [CHR-24] A parent marks a missed or late chore done on time (WP-117, D-151): when it is offered, the
// time it records, its words, and whether it changes a week or goal already settled. Pure, so the rules
// are tested without a database; the pages and the action use what it returns.

/** How a done chore was checked off, as `check_offs()` gives it. */
export interface CheckOff {
  /** The check-off's own time on the household's clock, 'YYYY-MM-DDTHH:MM'. */
  checkedAt: string;
  markedOnTime: boolean;
  /** The time the parent gave, 'HH:MM'; null for "On time". */
  onTimeAt: string | null;
  /** Who marked it on time (their member name), when known. */
  markedBy: string | null;
  /** The household day it was marked on time. */
  markedOn: string | null;
}

/** What `onTimeState` reads of an item. */
export interface OnTimeItem {
  kind: 'chore' | 'task';
  status: OccurrenceStatus;
  dueDate: string;
  /** 'HH:MM', or null for anytime. */
  dueTime: string | null;
}

export const isDoneStatus = (s: OccurrenceStatus) =>
  s === 'completed' || s === 'approved' || s === 'pending_approval';

/**
 * [CHR-24] A done chore was ticked late: after its due time on its day, or on a later day (a chore
 * without a due time). One marked on time is never late.
 */
export function isLateTick(item: OnTimeItem, c: CheckOff | null | undefined): boolean {
  if (item.kind !== 'chore' || !isDoneStatus(item.status) || !c || c.markedOnTime) return false;
  const day = c.checkedAt.slice(0, 10);
  if (day !== item.dueDate) return day > item.dueDate;
  return item.dueTime !== null && c.checkedAt.slice(11, 16) > item.dueTime.slice(0, 5);
}

/**
 * [CHR-24] Where a chore stands for Mark done on time: `missed` (missed, or still open on a day gone
 * by), `overdue` (open today past its due time), `late` (ticked late, or after `ruleTime`, a goal's
 * own time, on its day) — each offered **Done on time…** — or null (a task, not due yet, done on
 * time, skipped, or already marked on time). `now` is the household's clock, 'YYYY-MM-DDTHH:MM'.
 */
export function onTimeState(
  item: OnTimeItem,
  c: CheckOff | null | undefined,
  now: string,
  ruleTime: string | null = null,
): 'missed' | 'overdue' | 'late' | null {
  if (item.kind !== 'chore') return null;
  const today = now.slice(0, 10);
  if (item.dueDate > today) return null;
  const open = item.status === 'scheduled' || item.status === 'rejected';
  if (item.status === 'missed' || (open && item.dueDate < today)) return 'missed';
  if (open) {
    return item.dueTime !== null && now.slice(11, 16) > item.dueTime.slice(0, 5) ? 'overdue' : null;
  }
  if (isLateTick(item, c)) return 'late';
  // [RWD-17] After a goal's own time ("by 6:00 pm") on its day: late for that goal.
  return ruleTime && c && !c.markedOnTime && isDoneStatus(item.status)
    ? c.checkedAt.slice(0, 10) === item.dueDate && c.checkedAt.slice(11, 16) > ruleTime.slice(0, 5)
      ? 'late'
      : null
    : null;
}

/**
 * [CHR-24] The action's check: a chore that is offered Done on time…, or any done chore not marked on
 * time yet (one late only for a goal's own time is offered on that goal's day).
 */
export function canMarkOnTime(item: OnTimeItem, c: CheckOff | null | undefined, now: string) {
  if (onTimeState(item, c, now) !== null) return true;
  return (
    item.kind === 'chore' &&
    isDoneStatus(item.status) &&
    !c?.markedOnTime &&
    item.dueDate <= now.slice(0, 10)
  );
}

/** [CHR-24] The household's clock at an instant, 'YYYY-MM-DDTHH:MM'. */
export function householdNow(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
}

/** "Nov 13" for a household day. */
const short = (date: string) => monthDay(date);

/**
 * [CHR-24] The trace: "Marked on time by Alex, Nov 13", or "Marked on time (3:45 pm) by Alex, Nov 13"
 * when a time was given. Null for a check-off not marked on time.
 */
export function onTimeTrace(c: CheckOff | null | undefined): string | null {
  if (!c?.markedOnTime) return null;
  const time = c.onTimeAt ? ` (${clock(c.onTimeAt)})` : '';
  const on = c.markedOn ? `, ${short(c.markedOn)}` : '';
  return `Marked on time${time} by ${c.markedBy ?? 'a parent'}${on}`;
}

/**
 * [CHR-24] A late tick: "done late · ticked 8:10 pm, after 3:30 pm", or on a later day "done late ·
 * ticked Fri, Nov 13 at 7:05 am".
 */
export function lateWords(item: OnTimeItem, c: CheckOff): string {
  const day = c.checkedAt.slice(0, 10);
  const at = clock(c.checkedAt.slice(11, 16));
  if (day !== item.dueDate) return `done late · ticked ${shortDay(day)}, ${short(day)} at ${at}`;
  return `done late · ticked ${at}${item.dueTime ? `, after ${clock(item.dueTime)}` : ''}`;
}

/** [CHR-24] The latest time a parent may give: its due time, or the end of its day ('23:59'). */
export const latestTime = (dueTime: string | null) => (dueTime ? dueTime.slice(0, 5) : '23:59');

/** [CHR-24] The panel's line under "On time": "By its time, 3:30 pm." or "By the end of its day." */
export const onTimeLine = (dueTime: string | null) =>
  dueTime ? `By its time, ${clock(dueTime)}. Counts for every goal.` : 'Counts for every goal.';

/**
 * [CHR-24] The form's answer: "On time" (`at` null) or an earlier time 'HH:MM' on its day, by its due
 * time and not after now. Anything else is null (refused).
 */
export function readOnTime(
  when: unknown,
  at: unknown,
  item: Pick<OnTimeItem, 'dueDate' | 'dueTime'>,
  now: string,
): { at: string | null } | null {
  if (when === 'due') return { at: null };
  if (when !== 'at' || typeof at !== 'string') return null;
  const m = minutesOf(at);
  if (m === null) return null;
  const hhmm = at.slice(0, 5);
  if (hhmm > latestTime(item.dueTime)) return null;
  if (item.dueDate === now.slice(0, 10) && hhmm > now.slice(11, 16)) return null;
  if (item.dueDate > now.slice(0, 10)) return null;
  return { at: hhmm };
}

/** [CHR-24] The instant a given time is, on the chore's day in the household's zone (ISO). */
export function onTimeInstant(timeZone: string, date: string, hhmm: string): string {
  return new Date(localInstant(timeZone, date, minutesOf(hhmm)!)).toISOString();
}

/** [CHR-24] The notice after it. */
export const onTimeNotice = (title: string, names: string[] = []) =>
  `Marked ${title} done on time. It counts for ${
    names.length === 1 ? `${names[0]}’s` : 'their'
  } goals.`;

/**
 * [CHR-24] The facts as they would be with this occurrence marked on time: done and credited to those
 * who did it (covered for its other people), at the time given or none ("On time", never late).
 */
export function factsMarkedOnTime(
  facts: OccurrenceFact[],
  occurrenceId: string,
  doneBy: string[],
  dueDate: string,
  at: string | null,
): OccurrenceFact[] {
  return facts.map((f) => {
    if (f.id !== occurrenceId) return f;
    const did = doneBy.includes(f.member_id);
    return {
      ...f,
      status: did ? 'approved' : 'covered',
      credited: did,
      credit_date: dueDate,
      done_at: at ? `${dueDate}T${at}` : null,
    };
  });
}

export interface SettledGoal {
  title: string;
  repeat: Repeat;
  status: string;
  endDate: string | null;
  /** The child's name, or null for a family goal. */
  name: string | null;
  /** "10 points", "Ice cream from the shop", or null. */
  pays: string | null;
}

const points = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;

/** [CHR-24] What the confirm says, and what it pays ("10 points"), for the button. */
export interface SettledChange {
  text: string;
  pays: string | null;
}

function periodChange(
  b: PeriodResult,
  a: PeriodResult,
  g: SettledGoal,
  repeat: Exclude<Repeat, 'none'>,
): SettledChange | null {
  const whose = g.name ? `${g.name}’s` : 'the family’s';
  const which = `${whose} ${periodWord(repeat)} of ${short(b.start)}`;
  if (b.outcome !== 'won' && a.outcome === 'won') {
    const amount = a.step?.amount;
    const pays = amount != null ? points(amount) : g.pays;
    return { text: `This makes ${which} a win${pays ? `: ${pays}` : ''}.`, pays };
  }
  const bs = b.step?.reached;
  const as = a.step?.reached;
  if (as != null && (bs == null || as < bs)) {
    const more = (a.step?.amount ?? 0) - (b.step?.amount ?? 0);
    const pays = more > 0 ? points(more) : null;
    return { text: `This moves ${which} up a step${pays ? `: ${pays} more` : ''}.`, pays };
  }
  return null;
}

/**
 * [CHR-24][RWD-18] What marking on time changes in a week or goal already settled, in words for the
 * confirm ("This makes Maya’s week of Nov 9 a win: 10 points."); null when it changes nothing settled
 * (a week still going, or the same result). A period is settled once its last day has passed; a goal
 * that doesn't repeat once it is reached, ended or past its end date.
 */
export function settledChange(
  before: GoalEvaluation,
  after: GoalEvaluation,
  g: SettledGoal,
  today: string,
): SettledChange | null {
  if (g.repeat !== 'none') {
    for (const a of after.periods) {
      if (a.end >= today) continue;
      const b = before.periods.find((p) => p.start === a.start);
      if (!b) continue;
      const change = periodChange(b, a, g, g.repeat);
      if (change) return change;
    }
    return null;
  }
  const settled =
    g.status !== 'active' || (g.endDate !== null && g.endDate < today) || before.is_achieved;
  if (!settled) return null;
  if (!before.is_achieved && after.is_achieved) {
    const amount = after.step?.amount;
    const pays = amount != null ? points(amount) : g.pays;
    const who = g.name ? `${g.name} reach` : 'the family reach';
    return { text: `This makes ${who} “${g.title}”${pays ? `: ${pays}` : ''}.`, pays };
  }
  const bs = before.step?.reached;
  const as = after.step?.reached;
  if (as != null && (bs == null || as < bs)) {
    const more = (after.step?.amount ?? 0) - (before.step?.amount ?? 0);
    const pays = more > 0 ? points(more) : null;
    return { text: `This moves “${g.title}” up a step${pays ? `: ${pays} more` : ''}.`, pays };
  }
  return null;
}

/** One of a child's chores on their page's Missed or late. */
export interface MissedOrLateRow<T extends OnTimeItem & { id: string }> {
  item: T;
  state: 'missed' | 'overdue' | 'late' | 'marked';
  checkOff: CheckOff | null;
}

/** [CHR-24] How far back a child's page looks: the last 14 days, today included. */
export const MISSED_OR_LATE_DAYS = 14;

/**
 * [CHR-24] A child's page, Missed or late: their chores of the last 14 days that are missed, open past
 * their time, ticked late, or marked on time (with its trace), newest first, then by due time.
 */
export function missedOrLate<T extends OnTimeItem & { id: string; title: string }>(
  items: T[],
  checkOffs: Map<string, CheckOff>,
  now: string,
  from: string,
): MissedOrLateRow<T>[] {
  const rows: MissedOrLateRow<T>[] = [];
  for (const item of items) {
    if (item.dueDate < from) continue;
    const c = checkOffs.get(item.id) ?? null;
    const state =
      c?.markedOnTime && isDoneStatus(item.status) ? 'marked' : onTimeState(item, c, now);
    if (state) rows.push({ item, state, checkOff: c });
  }
  return rows.sort(
    (a, b) =>
      b.item.dueDate.localeCompare(a.item.dueDate) ||
      (a.item.dueTime ?? '99:99').localeCompare(b.item.dueTime ?? '99:99') ||
      a.item.title.localeCompare(b.item.title) ||
      a.item.id.localeCompare(b.item.id),
  );
}

/** [CHR-24] A goal going now, as the panel's "Counts for" line reads it. */
export interface CountingGoal {
  title: string;
  /** Null for a family goal. */
  memberId: string | null;
  startDate: string;
  endDate: string | null;
  scopes: RuleScope[];
}

/**
 * [CHR-24] The goals that count a chore: its person's (or a family goal), whose dates hold its day and
 * one of whose rules has it in scope, by title.
 */
export function countingGoals(
  item: { choreId: string; dueDate: string; memberId: string | null; assignees: string[] },
  tags: string[],
  goals: CountingGoal[],
): string[] {
  const fact = { chore_id: item.choreId, tag_ids: tags } as OccurrenceFact;
  const people = item.memberId ? [item.memberId] : item.assignees;
  return goals
    .filter(
      (g) =>
        (g.memberId === null || people.includes(g.memberId)) &&
        g.startDate <= item.dueDate &&
        (g.endDate === null || item.dueDate <= g.endDate) &&
        g.scopes.some((s) => inScope(fact, s)),
    )
    .map((g) => g.title);
}

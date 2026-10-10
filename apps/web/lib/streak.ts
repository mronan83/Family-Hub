import { evaluateHistory, type DayClass, type OccurrenceFact } from '@familywise/rules-engine';
import type { BoardStreak } from './snapshot';
import type { TodayItem } from './today';

/**
 * [RWD-05][US-408] The board's streak flame (WP-17, D-55): a child's good run as of the last closed
 * day (stored by day close), plus today once today counts as good. The board reads today with the
 * same rules engine the server uses, from the items it already shows, so the flame grows the moment
 * the last chore is ticked (D-51: today is good as soon as it qualifies, and never bad).
 */

/** Today's items as the engine reads them for one member (02 §5 OccurrenceFact). */
export function todayFacts(items: TodayItem[], memberId: string, today: string): OccurrenceFact[] {
  return items
    .filter(
      (i) =>
        i.memberId === memberId || i.assignees.includes(memberId) || i.doneBy.includes(memberId),
    )
    .map((i) => {
      const credited = i.doneBy.includes(memberId);
      const done =
        i.status === 'completed' || i.status === 'approved' || i.status === 'pending_approval';
      return {
        id: i.id,
        chore_id: i.choreId,
        member_id: memberId,
        kind: i.kind,
        tag_ids: [],
        due_date: i.dueDate,
        credit_date: i.kind === 'chore' ? i.dueDate : done ? today : null,
        status: i.doneBy.length > 0 && !credited ? 'covered' : i.status,
        credited,
        points: i.points,
      };
    });
}

/** How today stands for a member: good once every routine that counts is done. */
export function todayClass(items: TodayItem[], memberId: string, today: string): DayClass {
  const days = evaluateHistory({
    memberId,
    occurrences: todayFacts(items, memberId, today),
    asOf: today,
  }).days;
  return days.find((d) => d.date === today)?.dayClass ?? 'neutral';
}

/** Days in a row, today included once it is good; 0 when there is no good run. */
export function flameDays(
  streak: BoardStreak | null,
  items: TodayItem[],
  memberId: string,
  today: string,
): number {
  const run = streak?.kind === 'good' ? streak.length : 0;
  return run + (todayClass(items, memberId, today) === 'good' ? 1 : 0);
}

/** The milestones a run reaches, each a bigger flame (06 §7.2). */
export const MILESTONES = [3, 7, 14, 30] as const;

/** Which flame size a run gets: 0 below the first milestone, then 1 to 4. */
export function flameTier(days: number): number {
  return MILESTONES.filter((m) => days >= m).length;
}

/** A milestone just reached (the run grew onto it), to celebrate once (06 §6, ladder step 2). */
export function reachedMilestone(before: number, now: number): boolean {
  return now > before && (MILESTONES as readonly number[]).includes(now);
}

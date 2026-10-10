import type { OccurrenceStatus } from '@familywise/rules-engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DayItem } from '@/lib/admin-day';

// A parent's day (WP-12), read through RLS as the admin: private items only for those who may see
// them (D-34). Plain queries joined here: PostgREST cannot embed over the composite foreign keys.

const OCC_COLUMNS =
  'id, chore_id, kind, due_date, due_time, member_id, status, done_by, points_snapshot, status_event_id';

interface RawOcc {
  id: string;
  chore_id: string;
  kind: 'chore' | 'task';
  due_date: string;
  due_time: string | null;
  member_id: string | null;
  status: OccurrenceStatus;
  done_by: string[];
  points_snapshot: number;
  status_event_id: string | null;
}

/** Titles, icons and assignees for these occurrences; one whose item is archived is dropped when `dropIfArchived` says so. */
async function complete(
  db: SupabaseClient,
  rows: RawOcc[],
  { dropIfArchived }: { dropIfArchived: (o: RawOcc) => boolean },
): Promise<(DayItem & { statusEventId: string | null })[]> {
  if (rows.length === 0) return [];
  const [chores, assignees] = await Promise.all([
    db
      .from('chore')
      .select('id, title, icon, archived_at')
      .in('id', [...new Set(rows.map((r) => r.chore_id))]),
    db
      .from('chore_occurrence_assignee')
      .select('occurrence_id, member_id')
      .in(
        'occurrence_id',
        rows.map((r) => r.id),
      ),
  ]);
  if (chores.error) throw new Error(`chores: ${chores.error.message}`);
  if (assignees.error) throw new Error(`assignees: ${assignees.error.message}`);
  const chore = new Map(
    (
      chores.data as {
        id: string;
        title: string;
        icon: string | null;
        archived_at: string | null;
      }[]
    ).map((c) => [c.id, c]),
  );
  const people = new Map<string, string[]>();
  for (const a of assignees.data as { occurrence_id: string; member_id: string }[]) {
    people.set(a.occurrence_id, [...(people.get(a.occurrence_id) ?? []), a.member_id]);
  }
  return rows.flatMap((r) => {
    const c = chore.get(r.chore_id);
    if (!c || (c.archived_at && dropIfArchived(r))) return [];
    return [
      {
        id: r.id,
        choreId: r.chore_id,
        title: c.title,
        icon: c.icon,
        kind: r.kind,
        dueDate: r.due_date,
        dueTime: r.due_time ? r.due_time.slice(0, 5) : null,
        memberId: r.member_id,
        assignees: (people.get(r.id) ?? []).sort(),
        status: r.status,
        doneBy: [...r.done_by].sort(),
        points: r.points_snapshot,
        statusEventId: r.status_event_id,
      },
    ];
  });
}

/**
 * [CHR-06][CHR-12] One day's items for the household; on today, also the tasks still open from
 * before (D-31), as on the board, unless their item has been archived.
 */
export async function loadDay(
  db: SupabaseClient,
  householdId: string,
  date: string,
  today: string,
): Promise<DayItem[]> {
  const [day, overdue] = await Promise.all([
    db
      .from('chore_occurrence')
      .select(OCC_COLUMNS)
      .eq('household_id', householdId)
      .eq('due_date', date),
    date === today
      ? db
          .from('chore_occurrence')
          .select(OCC_COLUMNS)
          .eq('household_id', householdId)
          .eq('kind', 'task')
          .lt('due_date', date)
          .in('status', ['scheduled', 'rejected'])
      : Promise.resolve({ data: [] as RawOcc[], error: null }),
  ]);
  if (day.error) throw new Error(`day: ${day.error.message}`);
  if (overdue.error) throw new Error(`overdue: ${overdue.error.message}`);
  return complete(db, [...(day.data as RawOcc[]), ...(overdue.data as RawOcc[])], {
    dropIfArchived: (o) => o.due_date < date,
  });
}

export interface WaitingItem extends DayItem {
  /** When the check-off happened (ISO). */
  checkedAt: string | null;
  /** Checked off on another day than its due date (an offline board, D-21). */
  flagged: boolean;
}

/** [CHR-05][D-21] Everything waiting for a parent, oldest first, with when it was checked off. */
export async function loadWaiting(db: SupabaseClient, householdId: string): Promise<WaitingItem[]> {
  const { data, error } = await db
    .from('chore_occurrence')
    .select(OCC_COLUMNS)
    .eq('household_id', householdId)
    .eq('status', 'pending_approval')
    .order('due_date');
  if (error) throw new Error(`waiting: ${error.message}`);
  const items = await complete(db, data as RawOcc[], { dropIfArchived: () => false });
  const eventIds = items.map((i) => i.statusEventId).filter((id): id is string => id !== null);
  const events = eventIds.length
    ? await db
        .from('chore_completion_event')
        .select('id, occurred_at, review_status')
        .in('id', eventIds)
    : { data: [], error: null };
  if (events.error) throw new Error(`events: ${events.error.message}`);
  const event = new Map(
    (events.data as { id: string; occurred_at: string; review_status: string }[]).map((e) => [
      e.id,
      e,
    ]),
  );
  return items.map((i) => {
    const e = i.statusEventId ? event.get(i.statusEventId) : undefined;
    return { ...i, checkedAt: e?.occurred_at ?? null, flagged: e?.review_status === 'flagged' };
  });
}

/**
 * [CHR-14][US-316] My tasks: what I am on (as an assignee, or my own, D-47) from today through a week
 * ahead, and my tasks still open from before, unless their item has been archived.
 */
export async function loadMine(
  db: SupabaseClient,
  householdId: string,
  memberId: string,
  today: string,
  weekAhead: string,
): Promise<DayItem[]> {
  const [mine, overdue] = await Promise.all([
    db
      .from('chore_occurrence_assignee')
      .select('occurrence_id')
      .eq('household_id', householdId)
      .eq('member_id', memberId)
      .gte('due_date', today)
      .lte('due_date', weekAhead),
    db
      .from('chore_occurrence')
      .select('id')
      .eq('household_id', householdId)
      .eq('kind', 'task')
      .lt('due_date', today)
      .in('status', ['scheduled', 'rejected']),
  ]);
  if (mine.error) throw new Error(`mine: ${mine.error.message}`);
  if (overdue.error) throw new Error(`overdue: ${overdue.error.message}`);
  const overdueIds = (overdue.data as { id: string }[]).map((o) => o.id);
  const myOverdue = overdueIds.length
    ? await db
        .from('chore_occurrence_assignee')
        .select('occurrence_id')
        .eq('member_id', memberId)
        .in('occurrence_id', overdueIds)
    : { data: [], error: null };
  if (myOverdue.error) throw new Error(`mine overdue: ${myOverdue.error.message}`);
  const ids = [
    ...new Set(
      [...(mine.data ?? []), ...(myOverdue.data ?? [])].map(
        (a) => (a as { occurrence_id: string }).occurrence_id,
      ),
    ),
  ];
  if (ids.length === 0) return [];
  const { data, error } = await db.from('chore_occurrence').select(OCC_COLUMNS).in('id', ids);
  if (error) throw new Error(`my items: ${error.message}`);
  return complete(db, data as RawOcc[], { dropIfArchived: (o) => o.due_date < today });
}

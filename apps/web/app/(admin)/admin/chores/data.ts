import type { OccurrenceStatus } from '@familywise/rules-engine';
import type { IconName, MemberColor } from '@familywise/ui';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Approval, DayType, Kind, ListItem, OccurrenceDate, Schedule } from '@/lib/chores';

export interface ChoreRow extends ListItem {
  icon: IconName;
  points: number;
  approval: Approval;
  schedule: Schedule;
  dayTypes: DayType[];
  visibility: 'family' | 'private';
  createdBy: string | null;
}

export interface TagRow {
  id: string;
  name: string;
  color: MemberColor;
  icon: IconName | null;
  archivedAt: string | null;
}

interface RawChore {
  id: string;
  title: string;
  icon: IconName;
  kind: Kind;
  points: number;
  approval: Approval;
  schedule: Schedule;
  due_time: string | null;
  day_types: DayType[];
  visibility: 'family' | 'private';
  created_by: string | null;
  archived_at: string | null;
  chore_assignee: { member_id: string }[];
  chore_tag: { tag_id: string }[];
}

const CHORE_COLUMNS =
  'id, title, icon, kind, points, approval, schedule, due_time, day_types, visibility, created_by, archived_at, chore_assignee (member_id), chore_tag (tag_id)';

/**
 * [CHR-01][CHR-13] The household's items through RLS: family items, and private ones only for
 * their creator and assignees who sign in. Due times come back as "HH:MM".
 */
export async function loadChores(db: SupabaseClient, householdId: string): Promise<ChoreRow[]> {
  const { data, error } = await db
    .from('chore')
    .select(CHORE_COLUMNS)
    .eq('household_id', householdId);
  if (error) throw new Error(`chores: ${error.message}`);
  return (data as unknown as RawChore[]).map((r) => ({
    id: r.id,
    title: r.title,
    icon: r.icon,
    kind: r.kind,
    points: r.points,
    approval: r.approval,
    schedule: r.schedule,
    dueTime: r.due_time ? r.due_time.slice(0, 5) : null,
    dayTypes: r.day_types,
    visibility: r.visibility,
    createdBy: r.created_by,
    archivedAt: r.archived_at,
    assignees: r.chore_assignee.map((a) => a.member_id),
    tags: r.chore_tag.map((t) => t.tag_id),
  }));
}

/** [CHR-10] The household's tags, archived ones included, in the household's order. */
export async function loadTags(db: SupabaseClient, householdId: string): Promise<TagRow[]> {
  const { data, error } = await db
    .from('tag')
    .select('id, name, color, icon, archived_at')
    .eq('household_id', householdId)
    .order('sort_order')
    .order('name');
  if (error) throw new Error(`tags: ${error.message}`);
  return (
    data as {
      id: string;
      name: string;
      color: MemberColor;
      icon: IconName | null;
      archived_at: string | null;
    }[]
  ).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    icon: t.icon,
    archivedAt: t.archived_at,
  }));
}

/** Whether a parent approves check-offs, for the "family setting" choice on an item (CHR-05). */
export async function loadApprovalMode(
  db: SupabaseClient,
  householdId: string,
): Promise<'on' | 'off'> {
  const { data, error } = await db
    .from('household_settings')
    .select('approval_mode')
    .eq('household_id', householdId)
    .maybeSingle();
  if (error) throw new Error(`settings: ${error.message}`);
  return data?.approval_mode === 'on' ? 'on' : 'off';
}

/**
 * [CHR-03][CHR-12] The household's occurrences from `from` on (RLS: private items' only for those
 * who can see them), for each item's next date and how long a task has been left open.
 */
export async function loadOccurrenceDates(
  db: SupabaseClient,
  householdId: string,
  from: string,
): Promise<OccurrenceDate[]> {
  const { data, error } = await db
    .from('chore_occurrence')
    .select('chore_id, due_date, kind, status')
    .eq('household_id', householdId)
    .gte('due_date', from);
  if (error) throw new Error(`occurrences: ${error.message}`);
  return (data as { chore_id: string; due_date: string; kind: Kind; status: string }[]).map(
    (o) => ({ choreId: o.chore_id, dueDate: o.due_date, kind: o.kind, status: o.status }),
  );
}

export interface ComingUp {
  id: string;
  dueDate: string;
  status: OccurrenceStatus;
  /** Who did it, once someone has (a task done early, or today's chore). */
  doneBy: string[];
  /** Who it is for on that day (the snapshot, WP-09). */
  members: string[];
}

/** [CHR-03][CHR-09] An item's planned days from today, with who is responsible on each. */
export async function loadComingUp(
  db: SupabaseClient,
  choreId: string,
  today: string,
): Promise<ComingUp[]> {
  const { data, error } = await db
    .from('chore_occurrence')
    .select('id, due_date, status, done_by, chore_occurrence_assignee (member_id)')
    .eq('chore_id', choreId)
    .gte('due_date', today)
    .order('due_date')
    .limit(15);
  if (error) throw new Error(`coming up: ${error.message}`);
  return (
    data as unknown as {
      id: string;
      due_date: string;
      status: OccurrenceStatus;
      done_by: string[];
      chore_occurrence_assignee: { member_id: string }[];
    }[]
  ).map((o) => ({
    id: o.id,
    dueDate: o.due_date,
    status: o.status,
    doneBy: o.done_by,
    members: o.chore_occurrence_assignee.map((a) => a.member_id),
  }));
}

export type PastDay = { id: string; dueDate: string; status: OccurrenceStatus; doneBy: string[] };

/** [CHR-07] An item's last seven days before today, newest first, with who did each. */
export async function loadLastWeek(
  db: SupabaseClient,
  choreId: string,
  today: string,
): Promise<PastDay[]> {
  const weekAgo = new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await db
    .from('chore_occurrence')
    .select('id, due_date, status, done_by')
    .eq('chore_id', choreId)
    .gte('due_date', weekAgo)
    .lt('due_date', today)
    .order('due_date', { ascending: false });
  if (error) throw new Error(`last week: ${error.message}`);
  return (
    data as { id: string; due_date: string; status: OccurrenceStatus; done_by: string[] }[]
  ).map((o) => ({ id: o.id, dueDate: o.due_date, status: o.status, doneBy: o.done_by }));
}

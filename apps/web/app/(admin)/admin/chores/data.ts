import type { IconName, MemberColor } from '@familywise/ui';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Approval, DayType, Kind, ListItem, Schedule } from '@/lib/chores';

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

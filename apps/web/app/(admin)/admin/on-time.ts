import type { SupabaseClient } from '@supabase/supabase-js';
import type { OccurrenceStatus, Repeat, RuleScope } from '@familywise/rules-engine';
import { evaluateRead, type GoalPayout, type GoalRead, payoutWords } from '@/lib/goals';
import {
  type CheckOff,
  type CountingGoal,
  countingGoals,
  factsMarkedOnTime,
  onTimeState,
  type SettledChange,
  settledChange,
} from '@/lib/on-time';

// [CHR-24] Mark done on time (WP-117), the database side the pages share: how occurrences were
// checked off, and what marking one on time would change in a week or goal already settled.

interface RawCheckOff {
  occurrence_id: string;
  checked_at: string;
  marked_on_time: boolean;
  on_time_at: string | null;
  marked_by: string | null;
  marked_on: string | null;
}

/** [CHR-24] Each done or waiting occurrence's check-off, by occurrence id (RLS as the caller). */
export async function loadCheckOffs(
  db: SupabaseClient,
  ids: string[],
): Promise<Map<string, CheckOff>> {
  const out = new Map<string, CheckOff>();
  if (ids.length === 0) return out;
  const { data, error } = await db.rpc('check_offs', { p_occurrences: [...new Set(ids)] });
  if (error) throw new Error(`check-offs: ${error.message}`);
  for (const r of (data ?? []) as RawCheckOff[]) {
    out.set(r.occurrence_id, {
      checkedAt: r.checked_at,
      markedOnTime: r.marked_on_time,
      onTimeAt: r.on_time_at,
      markedBy: r.marked_by,
      markedOn: r.marked_on,
    });
  }
  return out;
}

export interface OnTimeOccurrence {
  id: string;
  householdId: string;
  dueDate: string;
  dueTime: string | null;
  kind: 'chore' | 'task';
  status: string;
  memberId: string | null;
  title: string;
}

/** [CHR-24] The occurrence a form names, with its title, as the caller may see it. */
export async function loadOnTimeOccurrence(
  db: SupabaseClient,
  id: string,
): Promise<OnTimeOccurrence | null> {
  const { data, error } = await db
    .from('chore_occurrence')
    .select('id, household_id, chore_id, due_date, due_time, kind, status, member_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`occurrence: ${error.message}`);
  if (!data) return null;
  const chore = await db.from('chore').select('title').eq('id', data.chore_id).maybeSingle();
  return {
    id: data.id,
    householdId: data.household_id,
    dueDate: data.due_date,
    dueTime: data.due_time ? String(data.due_time).slice(0, 5) : null,
    kind: data.kind,
    status: data.status,
    memberId: data.member_id,
    title: (chore.data as { title: string } | null)?.title ?? 'it',
  };
}

interface GoalRow {
  id: string;
  title: string;
  member_id: string | null;
  status: string;
  end_date: string | null;
  repeats: Repeat | null;
  payout: GoalPayout;
}

/**
 * [CHR-24][RWD-18] What marking this occurrence on time, done by these people at this time (null:
 * "On time"), would change in a week or goal already settled: the first such change, in words, and
 * the goals it may move (worked out again after it is marked). Read as the parent (RLS).
 */
export async function onTimeChanges(
  db: SupabaseClient,
  occ: OnTimeOccurrence,
  doneBy: string[],
  at: string | null,
  today: string,
  name: (id: string) => string | null,
): Promise<{ change: SettledChange | null; goals: string[] }> {
  const { data, error } = await db
    .from('reward_goal')
    .select('id, title, member_id, status, end_date, repeats, payout, start_date')
    .eq('household_id', occ.householdId)
    .in('status', ['active', 'achieved', 'expired', 'redeemed'])
    .lte('start_date', occ.dueDate);
  if (error) throw new Error(`goals: ${error.message}`);
  const goals = ((data ?? []) as (GoalRow & { start_date: string })[]).filter(
    (g) =>
      (g.end_date === null || g.end_date >= occ.dueDate) &&
      (g.member_id === null || doneBy.includes(g.member_id) || g.member_id === occ.memberId),
  );
  let change: SettledChange | null = null;
  for (const g of goals) {
    if (change) break;
    const read = await db.rpc('goal_facts', { p_goal: g.id });
    if (read.error) throw new Error(`goal facts: ${read.error.message}`);
    const before = read.data as GoalRead;
    if (!before.facts.some((f) => f.id === occ.id)) continue;
    const after: GoalRead = {
      ...before,
      facts: factsMarkedOnTime(before.facts, occ.id, doneBy, occ.dueDate, at),
    };
    change = settledChange(
      evaluateRead(before),
      evaluateRead(after),
      {
        title: g.title,
        repeat: g.repeats ?? 'none',
        status: g.status,
        endDate: g.end_date,
        name: g.member_id ? name(g.member_id) : null,
        pays: payoutWords(g.payout, g.member_id === null, () => undefined),
      },
      today,
    );
  }
  return { change, goals: goals.map((g) => g.id) };
}

/**
 * [CHR-24] For each of these items, the goals going now that count it (the panel's "Counts for"
 * line), read as the parent: the household's goals with their rules' scopes, and the items' tags.
 */
export async function loadCountingGoals(
  db: SupabaseClient,
  householdId: string,
  items: {
    id: string;
    choreId: string;
    dueDate: string;
    memberId: string | null;
    assignees: string[];
  }[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (items.length === 0) return out;
  const [goals, rules, tags] = await Promise.all([
    db
      .from('reward_goal')
      .select('id, title, member_id, start_date, end_date')
      .eq('household_id', householdId)
      .in('status', ['active', 'achieved', 'expired']),
    db.from('reward_rule').select('goal_id, scope').eq('household_id', householdId),
    db
      .from('chore_tag')
      .select('chore_id, tag_id')
      .in('chore_id', [...new Set(items.map((i) => i.choreId))]),
  ]);
  if (goals.error) throw new Error(`goals: ${goals.error.message}`);
  if (rules.error) throw new Error(`rules: ${rules.error.message}`);
  if (tags.error) throw new Error(`tags: ${tags.error.message}`);
  const scopes = new Map<string, RuleScope[]>();
  for (const r of (rules.data ?? []) as { goal_id: string; scope: RuleScope }[]) {
    scopes.set(r.goal_id, [...(scopes.get(r.goal_id) ?? []), r.scope ?? {}]);
  }
  const counting: CountingGoal[] = (
    (goals.data ?? []) as {
      id: string;
      title: string;
      member_id: string | null;
      start_date: string;
      end_date: string | null;
    }[]
  ).map((g) => ({
    title: g.title,
    memberId: g.member_id,
    startDate: g.start_date,
    endDate: g.end_date,
    scopes: scopes.get(g.id) ?? [],
  }));
  const tagsOf = new Map<string, string[]>();
  for (const t of (tags.data ?? []) as { chore_id: string; tag_id: string }[]) {
    tagsOf.set(t.chore_id, [...(tagsOf.get(t.chore_id) ?? []), t.tag_id]);
  }
  for (const i of items) {
    const titles = countingGoals(i, tagsOf.get(i.choreId) ?? [], counting);
    if (titles.length) out.set(i.id, titles);
  }
  return out;
}

/** [CHR-24] The address a page comes back with after a Done on time… that asks first. */
export interface OnTimeParams {
  confirm?: string;
  when?: string;
  at?: string;
  by?: string;
  item?: string;
  did?: string;
  error?: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^\d{2}:\d{2}$/;

/**
 * [CHR-24] What a page's rows need for Done on time…: the household's clock, the goals that count
 * each offered item, and the confirm for the item the address names (worked out again here, so the
 * words are this moment's).
 */
export async function onTimeRow(
  db: SupabaseClient,
  household: { id: string; timezone: string },
  items: (OnTimeItemRow & { checkOff?: CheckOff | null })[],
  params: OnTimeParams,
  members: { id: string; displayName: string }[],
  returnTo: string,
  now: string,
): Promise<{
  now: string;
  returnTo: string;
  goals: Map<string, string[]>;
  confirm:
    (SettledChange & { item: string; when: 'due' | 'at'; at: string | null; by: string[] }) | null;
  open: string | null;
}> {
  const offered = items.filter((i) => onTimeState(i, i.checkOff, now) !== null);
  const goals = await loadCountingGoals(db, household.id, offered);
  let confirm = null;
  const asked = offered.find((i) => i.id === params.confirm);
  if (asked) {
    const by = (params.by ?? '').split(',').filter((id) => GUID.test(id));
    const at = params.when === 'at' && params.at && HHMM.test(params.at) ? params.at : null;
    const { change } = await onTimeChanges(
      db,
      { ...asked, householdId: household.id },
      by,
      at,
      now.slice(0, 10),
      (id) => members.find((m) => m.id === id)?.displayName ?? null,
    );
    if (change)
      confirm = {
        ...change,
        item: asked.id,
        when: at ? ('at' as const) : ('due' as const),
        at,
        by,
      };
  }
  // A Done on time… that wasn't recorded opens again, to try again.
  const failedOn =
    params.item && params.error?.startsWith('ontime') && GUID.test(params.item)
      ? params.item
      : null;
  return { now, returnTo, goals, confirm, open: failedOn };
}

type OnTimeItemRow = {
  id: string;
  choreId: string;
  title: string;
  kind: 'chore' | 'task';
  status: OccurrenceStatus;
  dueDate: string;
  dueTime: string | null;
  memberId: string | null;
  assignees: string[];
};

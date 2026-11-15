import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { goalRefusal } from '@/lib/goals';
import { serverClient } from '@/lib/supabase/server';
import { loadGoals } from './data';
import { bringGoalsUpToDate, loadGoalContext } from './load';
import { randomUUID } from 'node:crypto';
import type { RuleScope } from '@familywise/rules-engine';
import { countingGoals, householdNow, onTimeNotice, onTimeState } from '@/lib/on-time';
import { loadMembers } from '../members/data';
import { loadCheckOffs, type OnTimeParams, onTimeRow } from '../on-time';
import { loadDay, loadMemberChores } from '../today/data';
import { GoalsView } from './view';
import type { GoalDayProps } from './goal-day';

export const metadata: Metadata = { title: 'Goals' };

const DID: Record<string, string> = {
  redeem: 'Marked redeemed. It’s in the history.',
  cancel: 'Cancelled. It’s in the history.',
  review: 'Cleared.',
  stop: 'It stops after the period going now.',
};

/** [RWD-01][RWD-04][RWD-09] The family's goals, brought up to date first, as this admin through RLS. */
export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<
    { did?: string; error?: string; saved?: string; day?: string } & OnTimeParams
  >;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/goals');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const params = await searchParams;
  const stale = await bringGoalsUpToDate(db!, household.id);
  const [goals, ctx] = await Promise.all([
    loadGoals(db!, household.id),
    loadGoalContext(db!, household),
  ]);
  // [CHR-24] A goal's missed or late day, opened from its mark (WP-117): the chores it counts that day
  // that can be marked on time.
  const now = householdNow(household.timezone);
  const [dayGoal, dayDate] = (params.day ?? '').split(':');
  const goal = goals.find((g) => g.id === dayGoal);
  let day: GoalDayProps | null = null;
  let dayNotice: string | null = null;
  if (goal && dayDate && /^\d{4}-\d{2}-\d{2}$/.test(dayDate) && dayDate <= now.slice(0, 10)) {
    const members = await loadMembers(db!, household.id);
    const chores = goal.memberId
      ? await loadMemberChores(db!, household.id, goal.memberId, dayDate, dayDate)
      : (await loadDay(db!, household.id, dayDate, now.slice(0, 10))).filter(
          (i) => i.kind === 'chore' && i.dueDate === dayDate,
        );
    const checks = await loadCheckOffs(
      db!,
      chores.map((c) => c.id),
    );
    const scopes = goal.rules.map((r) => r.scope as RuleScope);
    const onTimes = goal.rules
      .map((r) => r.params.on_time)
      .filter((t): t is string => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t))
      .sort();
    const ruleTime = onTimes[0] ?? null;
    const tags = await db!
      .from('chore_tag')
      .select('chore_id, tag_id')
      .in('chore_id', [...new Set(chores.map((c) => c.choreId))]);
    const tagsOf = (id: string) =>
      ((tags.data ?? []) as { chore_id: string; tag_id: string }[])
        .filter((t) => t.chore_id === id)
        .map((t) => t.tag_id);
    const items = chores
      .map((c) => ({ ...c, checkOff: checks.get(c.id) ?? null }))
      .filter(
        (c) =>
          (onTimeState(c, c.checkOff, now, ruleTime) !== null || c.checkOff?.markedOnTime) &&
          countingGoals(c, tagsOf(c.choreId), [
            {
              title: goal.title,
              memberId: goal.memberId,
              startDate: goal.startDate,
              endDate: goal.endDate,
              scopes,
            },
          ]).length > 0,
      );
    const returnTo = `/admin/goals?day=${goal.id}:${dayDate}`;
    day = {
      goalId: goal.id,
      date: dayDate,
      rows: items,
      onTime: await onTimeRow(db!, household, items, params, members, returnTo, now),
      people: members.filter((m) => !m.archivedAt),
      request: randomUUID(),
    };
    if (params.did === 'ontime') {
      const done = chores.find((c) => c.id === params.item);
      dayNotice = onTimeNotice(
        done?.title ?? 'it',
        done
          ? done.doneBy.map((id) => members.find((m) => m.id === id)?.displayName ?? 'Someone')
          : [],
      );
    }
  }
  const notice = params.saved
    ? `Saved ${params.saved}.`
    : dayNotice
      ? dayNotice
      : params.did
        ? (DID[params.did] ?? null)
        : stale;
  return (
    <GoalsView
      goals={goals}
      members={ctx.members}
      names={ctx.names}
      admins={ctx.adminNames}
      prizes={ctx.prizeNames}
      timezone={household.timezone}
      today={isoDay(household.timezone)}
      notice={notice}
      error={
        params.error?.startsWith('ontime') || (day && params.error)
          ? 'That wasn’t marked on time. Choose On time, or a time on its day up to its due time, and who did it.'
          : params.error
            ? goalRefusal({ hint: params.error })
            : null
      }
      day={day}
    />
  );
}

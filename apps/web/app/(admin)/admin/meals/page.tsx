import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { copyWords, type Slot, SLOTS, weekDays, weekFrom } from '@/lib/meals';
import { serverClient } from '@/lib/supabase/server';
import { loadMembers } from '../members/data';
import { lunchRefusal } from '@/lib/lunch';
import { loadLunch, loadMeals, loadPlan } from './data';
import { MealsView } from './view';

export const metadata: Metadata = { title: 'Meals' };

const DID: Record<string, string> = {
  added: 'Added to the plan.',
  moved: 'Moved.',
  removed: 'Removed from the plan.',
  lunch: 'Lunch changed.',
  usual: 'Usual lunches saved.',
};

/** [MEAL-01][MEAL-03] The week's meals (`?week=` any day of it; this week by default). */
export default async function MealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/meals');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const p = await searchParams;
  const today = isoDay(household.timezone);
  const week = weekFrom(p.week, today, household.weekStart);
  const days = weekDays(week);
  const [entries, meals, members, lunch] = await Promise.all([
    loadPlan(db!, household.id, days[0]!, days[6]!),
    loadMeals(db!, household.id),
    loadMembers(db!, household.id),
    loadLunch(db!, household.id, week),
  ]);
  const addAt =
    p.day && days.includes(p.day) && SLOTS.includes(p.slot as Slot)
      ? { day: p.day, slot: p.slot as Slot }
      : null;
  const copied =
    p.copied !== undefined
      ? copyWords({
          copied: Number(p.copied) || 0,
          skipped: Number(p.skipped) || 0,
          replaced: Number(p.replaced) || 0,
        })
      : null;
  return (
    <MealsView
      week={week}
      today={today}
      days={days}
      entries={entries}
      meals={meals}
      members={members
        .filter((m) => !m.archivedAt)
        .map((m) => ({ id: m.id, displayName: m.displayName }))}
      addAt={addAt}
      newId={crypto.randomUUID()}
      lunch={lunch}
      notice={copied ?? (p.did ? (DID[p.did] ?? null) : null)}
      error={
        p.lunch
          ? lunchRefusal({ hint: p.lunch })
          : p.did === 'failed'
            ? 'That didn’t change. Try again in a moment.'
            : null
      }
    />
  );
}

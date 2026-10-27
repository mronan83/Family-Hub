import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { countableGoals, loadGoals } from '../data';
import { GoalForm } from '../goal-form';
import { GoalHead } from '../view';
import { loadGoalContext } from '../load';

export const metadata: Metadata = { title: 'Set a goal' };

/** [RWD-01] A new goal. Its id is made here, so sending the form twice sets one goal. */
export default async function NewGoalPage() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/goals/new');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [ctx, goals] = await Promise.all([
    loadGoalContext(db!, household),
    loadGoals(db!, household.id),
  ]);
  return (
    <main className="fw-page">
      <AdminHeader current="/admin/goals" />
      <GoalHead title="Set a goal" />
      <section className="fw-card">
        <GoalForm
          id={crypto.randomUUID()}
          members={ctx.earners}
          tags={ctx.tags}
          items={ctx.items}
          prizes={ctx.prizes}
          today={isoDay(household.timezone)}
          countable={countableGoals(goals)}
        />
      </section>
    </main>
  );
}

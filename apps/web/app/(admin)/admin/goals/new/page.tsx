import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { GOAL_ICONS } from '../data';
import { GoalForm } from '../goal-form';
import { loadGoalContext } from '../load';

export const metadata: Metadata = { title: 'Set a goal' };

/** [RWD-01] A new goal. Its id is made here, so sending the form twice sets one goal. */
export default async function NewGoalPage() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/goals/new');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const ctx = await loadGoalContext(db!, household.id);
  return (
    <main className="fw-page">
      <AdminHeader current="/admin/goals" />
      <section className="fw-card">
        <h1>Set a goal</h1>
        <GoalForm
          id={crypto.randomUUID()}
          members={ctx.earners}
          tags={ctx.tags}
          items={ctx.items}
          icons={GOAL_ICONS}
          today={isoDay(household.timezone)}
        />
      </section>
    </main>
  );
}

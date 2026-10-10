import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { REWARD_ICONS } from '../data';
import { RewardForm } from '../reward-form';

export const metadata: Metadata = { title: 'Add a reward' };

/** [PTS-03] A new reward for the shop. */
export default async function NewRewardPage() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/rewards/new');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return (
    <main className="fw-page">
      <AdminHeader current="/admin/rewards" />
      <section className="fw-card">
        <h1>Add a reward</h1>
        <RewardForm icons={REWARD_ICONS} />
      </section>
    </main>
  );
}

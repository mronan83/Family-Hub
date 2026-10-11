import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { loadMeals } from '../data';
import { MealLibraryView } from './view';

export const metadata: Metadata = { title: 'Meal library' };

/** [MEAL-02] The meal library. */
export default async function MealLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; did?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/meals/library');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const p = await searchParams;
  const notice = p.saved
    ? `Saved ${p.saved}.`
    : p.did === 'archived'
      ? 'Archived. Plans that used it keep it.'
      : p.did === 'restored'
        ? 'Restored. It’s offered again when you plan.'
        : null;
  return (
    <MealLibraryView
      meals={await loadMeals(db!, household.id)}
      notice={notice}
      error={p.did === 'failed' ? 'That didn’t change. Try again in a moment.' : null}
    />
  );
}

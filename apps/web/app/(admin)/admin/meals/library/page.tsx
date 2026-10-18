import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { loadMeals } from '../data';
import { MealLibraryView } from './view';

export const metadata: Metadata = { title: 'Meal library' };

/** [MEAL-02] The meal library; [D-132] ?edit= a meal's form open under its row, ?copy= Duplicate. */
export default async function MealLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    did?: string;
    edit?: string;
    copy?: string;
    notCopied?: string;
  }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/meals/library');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const p = await searchParams;
  const notice = p.saved
    ? `Saved ${p.saved}.${
        Number(p.notCopied) > 0
          ? ` ${p.notCopied === '1' ? 'One photo or PDF' : `${p.notCopied} photos or PDFs`} didn’t copy: add ${p.notCopied === '1' ? 'it' : 'them'} again in its form.`
          : ''
      }`
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
      openArchived={p.did === 'archived'}
      householdId={household.id}
      editing={p.edit ?? null}
      copy={p.copy ?? null}
    />
  );
}

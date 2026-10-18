import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { loadGroceries } from './data';
import { type GroceriesQuery, GroceriesView } from './view';

export const metadata: Metadata = { title: 'Groceries' };

/** [MEAL-18][MEAL-23][MEAL-24] Groceries (WP-104). */
export default async function GroceriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/groceries');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const p = await searchParams;
  const query = Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as GroceriesQuery;
  const now = new Date().getTime();
  return (
    <GroceriesView
      data={await loadGroceries(db!, household.id, now)}
      timezone={household.timezone}
      now={now}
      query={query}
      error={null}
    />
  );
}

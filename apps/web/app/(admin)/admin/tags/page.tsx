import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { loadChores, loadTags } from '../chores/data';
import { TagsView } from './view';

export const metadata: Metadata = { title: 'Tags' };

// [CHR-10] The household's tags (D-33), read through RLS, with how many items use each; [NFR-18]
// ?open= the fold saved in (WP-94).
export default async function TagsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; open?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/tags');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [tags, chores] = await Promise.all([
    loadTags(db!, household.id),
    loadChores(db!, household.id),
  ]);
  const uses: Record<string, number> = {};
  for (const c of chores) for (const t of c.tags) uses[t] = (uses[t] ?? 0) + 1;
  const { saved, open } = await searchParams;
  return <TagsView tags={tags} uses={uses} saved={saved ?? null} open={open ?? null} />;
}

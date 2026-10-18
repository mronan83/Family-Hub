import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { loadMembers } from '../../members/data';
import { loadApprovalMode, loadChores, loadTags } from '../data';
import { NewItemView } from '../new-view';

export const metadata: Metadata = { title: 'Add to the list' };

// [CHR-01] Add a chore or a task. "Save and add another" comes back here with the same kind, so a
// parent can enter the whole family list in one go. [CHR-22][CHR-23] ?from=<id> is Duplicate: the
// form filled in from that item, named "(copy)"; with &on=<date> it is Do again's "Change more
// first", a one-time item on that date. Nothing is saved until Save (D-132).
export default async function NewChorePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; saved?: string; from?: string; on?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/chores/new');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const { kind, saved, from, on } = await searchParams;
  const [members, tags, approvalMode, chores] = await Promise.all([
    loadMembers(db!, household.id),
    loadTags(db!, household.id),
    loadApprovalMode(db!, household.id),
    from ? loadChores(db!, household.id) : Promise.resolve([]),
  ]);
  const date = on && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : undefined;
  return (
    <NewItemView
      members={members}
      tags={tags}
      approvalMode={approvalMode}
      today={isoDay(household.timezone)}
      kind={kind}
      saved={saved}
      original={from ? chores.find((c) => c.id === from) : undefined}
      date={date}
    />
  );
}

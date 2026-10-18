import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { loadMembers } from '../../members/data';
import { loadApprovalMode, loadChores, loadComingUp, loadLastWeek, loadTags } from '../data';
import { ItemView } from '../item-view';

export const metadata: Metadata = { title: 'Edit item' };

// [CHR-01][CHR-13] Edit a chore or task. A private item someone else created, and not assigned to
// this admin, is not found (RLS). Only the item's creator is offered the private switch.
// [NFR-18] Folded (WP-96, ItemView); ?open= opens Coming up or Last 7 days (coming-up, last-week).
export default async function EditChorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ open?: string }>;
}) {
  const { id } = await params;
  const { open } = await searchParams;
  const db = await serverClient();
  const user = await requireSignedIn(db, `/admin/chores/${id}`);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [chores, members, tags, approvalMode] = await Promise.all([
    loadChores(db!, household.id),
    loadMembers(db!, household.id),
    loadTags(db!, household.id),
    loadApprovalMode(db!, household.id),
  ]);
  const item = chores.find((c) => c.id === id);
  if (!item) notFound();
  const mine = item.createdBy === null || item.createdBy === user.userId;
  const today = isoDay(household.timezone);
  const [comingUp, lastWeek] = await Promise.all([
    loadComingUp(db!, item.id, today),
    loadLastWeek(db!, item.id, today),
  ]);
  return (
    <ItemView
      item={item}
      members={members}
      tags={tags}
      approvalMode={approvalMode}
      mine={mine}
      today={today}
      comingUp={comingUp}
      lastWeek={lastWeek}
      open={open ?? null}
    />
  );
}

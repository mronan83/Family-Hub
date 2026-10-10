import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { noticeFor } from '@/lib/admin-day';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { loadMembers } from '../members/data';
import { loadBells, loadSettings } from '../reminders/data';
import { loadMine } from '../today/data';
import { MyTasksView } from './view';

export const metadata: Metadata = { title: 'My tasks' };

const ERRORS: Record<string, string> = {
  title: 'Give it a name, up to 80 characters.',
  gone: 'That item changed: it was taken off the list.',
  failed: 'That didn’t save. Try again in a moment.',
};

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * [CHR-14][US-316] My tasks: "me" is the member linked to this sign-in (Members: Their sign-in).
 * Read as this admin through RLS.
 */
export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    added?: string;
    did?: string;
    item?: string;
    error?: string;
    bell?: string;
    chore?: string;
  }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/my');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const params = await searchParams;
  const today = isoDay(household.timezone);
  const members = await loadMembers(db!, household.id);
  const me = members.find((m) => m.userId === user.userId && !m.archivedAt) ?? null;
  const [items, bells, settings] = me
    ? await Promise.all([
        loadMine(db!, household.id, me.id, today, shift(today, 7)),
        loadBells(db!, household.id, me.id),
        loadSettings(db!, me.id),
      ])
    : [[], new Map<string, boolean | null>(), null];

  const known = items.find((i) => i.id === params.item);
  const bellItem = items.find((i) => i.choreId === params.chore);
  const notice = params.added
    ? `Added ${params.added} for today.`
    : (params.bell === 'on' || params.bell === 'off') && bellItem
      ? params.bell === 'on'
        ? `${bellItem.title} reminds you.`
        : `${bellItem.title} won’t remind you.`
      : (params.did === 'done' || params.did === 'uncheck') && known
        ? noticeFor(params.did, known.title)
        : null;

  return (
    <MyTasksView
      today={today}
      me={me?.id ?? null}
      items={items}
      people={members.filter((m) => !m.archivedAt)}
      notice={notice}
      error={params.error ? (ERRORS[params.error] ?? ERRORS.failed!) : null}
      request={crypto.randomUUID()}
      bells={bells}
      defaultOn={settings?.defaultOn ?? true}
      remindersOn={settings?.enabled ?? false}
    />
  );
}

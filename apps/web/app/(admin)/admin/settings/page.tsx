import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import {
  boardsStatus,
  calendarsStatus,
  familyStatus,
  healthStatus,
  remindersStatus,
  schoolStatus,
  tagsStatus,
} from '@/lib/settings-status';
import { serverClient } from '@/lib/supabase/server';
import { loadApprovalMode, loadTags } from '../chores/data';
import { loadMembers } from '../members/data';
import { loadDevices, loadSettings } from '../reminders/data';
import { loadYears } from '../school/data';
import { SettingsView } from './view';

export const metadata: Metadata = { title: 'Settings' };

/** [NFR-15][US-107] Settings (WP-51, D-81): how each part of the set-up stands, read through RLS. */
export default async function SettingsPage() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/settings');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [years, calendars, boards, tags, members, jobs, approval, week] = await Promise.all([
    loadYears(db!, household.id),
    db!.from('calendar_source').select('name, status').eq('household_id', household.id),
    db!
      .from('device')
      .select('name, revoked_at')
      .eq('household_id', household.id)
      .order('created_at'),
    loadTags(db!, household.id),
    loadMembers(db!, household.id),
    db!.rpc('job_health', { p_household_id: household.id }),
    loadApprovalMode(db!, household.id),
    db!
      .from('household_settings')
      .select('week_start_next, week_start_next_on')
      .eq('household_id', household.id)
      .maybeSingle(),
  ]);
  for (const r of [calendars, boards, jobs]) {
    if (r.error) throw new Error(`settings: ${r.error.message}`);
  }
  const me = members.find((m) => m.userId === user.userId && !m.archivedAt)?.id ?? null;
  const [reminders, devices] = me
    ? await Promise.all([loadSettings(db!, me), loadDevices(db!, me)])
    : [null, []];
  const cals = (calendars.data ?? []) as { name: string; status: string }[];
  const needLook = ((jobs.data ?? []) as { state: string }[]).filter(
    (j) => j.state === 'failing' || j.state === 'stale',
  ).length;

  return (
    <SettingsView
      status={{
        '/admin/settings/family': familyStatus(
          household.weekStart,
          week.data?.week_start_next != null && week.data.week_start_next_on
            ? { day: week.data.week_start_next, on: week.data.week_start_next_on }
            : null,
          approval,
        ),
        '/admin/school': schoolStatus(
          years.map((y) => ({
            name: y.name,
            startDate: y.startDate,
            endDate: y.endDate,
            isDefault: y.isDefault,
            archived: !!y.archivedAt,
          })),
          isoDay(household.timezone),
        ),
        '/admin/calendars': calendarsStatus(cals),
        '/admin/devices': boardsStatus(
          ((boards.data ?? []) as { name: string; revoked_at: string | null }[]).map((b) => ({
            name: b.name,
            revoked: !!b.revoked_at,
          })),
        ),
        '/admin/tags': tagsStatus(tags.map((t) => ({ archived: !!t.archivedAt }))),
        '/admin/reminders': remindersStatus(!!me, !!reminders?.enabled, devices),
        '/admin/health': healthStatus(needLook, cals.filter((c) => c.status === 'error').length),
      }}
    />
  );
}
